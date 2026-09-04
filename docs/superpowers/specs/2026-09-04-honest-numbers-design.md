# Honest numbers — design (2026-09-04)

Audit items 1–4 of `2026-09-02-fresh-eyes-dashboard-audit.md` §13 plus the derived-parent fix,
as one program: the wizard stops writing implicit zeros, "entered" means entered everywhere,
one savings definition feeds every page, categories carry a kind, and a parent account with
components is derived rather than typed. Approved in conversation 2026-09-04.

## 0. Why, with production's own numbers (census 2026-09-04, read-only)

| Fact on production | Consequence today |
|---|---|
| Sep 2026 spending = 19 rows of `$0.00`, no net pay (a balances-only save) | Footer says "Spending through Sep 2026"; charts draw a real `$0` month; movers read −100%; Housing's 12-month average is $1,991 instead of $2,172; the Health card says "delete it" |
| Aug 2026 has no spending rows and no net pay | Nothing flags it: the reminder reads balance months only, and balances exist |
| Projection annual spend = mean of the LAST 12 spending months × 12 (zero month included) | $65,779 → FI target $1,644,479; on the 12 real months it is $70,054 → $1,751,344 |
| Projection cash savings = mean(net pay − spend) over months WITH net pay | Different window (Aug 2025–Jul 2026) from the spend window (Sep 2025–Sep 2026) |
| 2026 rollup: net pay $44,611.60 (Jan–Jul) vs spend $45,608.58 | Overview YTD reads −2.2% |
| Edward's profile deducts 13% trad + 3% after-tax + 11–12% ESPP + $100 HSA per check ≈ $4,451–$4,608/month; Grace's from Sep 1 ≈ $400/month | No savings-rate tile counts any of it; the projection (after the 09-03 fix) does |
| "Taxes" category = $5,044.00 (Apr 2026) | Counted as living spend: April reads −48%, the year negative, the FI target $126k higher; the sankey shows taxes twice |
| Fidelity Traditional 401(k) and Fidelity Roth 401(k) have 3 and 2 components; parent = Σ components in all 37 months | Two totals typed by hand every month; nothing checks them; raw sums that forget `is_component` overstate net worth by $194,411.66 |

## 1. Category kinds

**Model.** `spending_categories.kind` — `String(16)`, NOT NULL, server default `'living'`, CHECK in
(`living`, `tax`, `transfer`). One Alembic revision chained on `d4f6b8c0e2a5` (the only
migration this program writes). The upgrade seeds by slug/name, case-insensitive: `taxes` → `tax`;
`investments`, `financial` → `transfer`; everything else `living`. Downgrade drops the column.

**Meaning.** `living`: money that left the household (food, housing, loan payments — a payment
you must fund each month is living cost). `tax`: an income-tax payment made from take-home (the
April bill, estimated payments); payroll withholding is NOT here — it never reaches net pay.
`transfer`: money that stayed yours (to a brokerage, savings, extra principal) — part of net
worth, not spend.

**API.** `CategoryOut.kind`, `CategoryCreate.kind` (default `living`), `CategoryUpdate.kind`.
Kinds apply to ALL history — changing a kind recomputes every figure that reads it; the Settings
copy says so. Fixed-vs-discretionary is out of scope.

**UI.** Settings › Categories: a three-way `Segmented` per row (Living · Tax · Transfer) with a one-line
explanation of each; the badge on Spending's yearly rollup and heatmap legend names non-living
categories ("tax", "transfer") so their exclusion is visible, never silent.

## 2. One savings definition

New `backend/app/services/savings.py`, the only place these words are defined. Per calendar month
`m` with a spending or cashflow row:

```
living_spend(m)   = Σ amount over categories with kind = living
tax_paid(m)       = Σ amount over kind = tax
transfers(m)      = Σ amount over kind = transfer
net_pay(m)        = monthly_cashflow.net_pay, or None
cash_savings(m)   = net_pay − living_spend − tax_paid          (None when net_pay is None)
payroll_savings(m)= Σ over people of payroll_monthly(profile in force on the 1st of m)
                    — only when net_pay(m) is not None (a month nobody entered pay for has no
                    deductions on record either)
total_savings(m)  = cash_savings + payroll_savings              (None when net_pay is None)
cash_rate(m)      = cash_savings / net_pay                      (None when net_pay is None or 0)
total_rate(m)     = total_savings / (net_pay + payroll_savings)  (same guard)
```

`payroll_monthly(profile)` is the projection's existing arithmetic, moved into this module and
imported back by `api/projection.py`: `(salary / pay_periods) × (trad + roth + after_tax + espp)
+ hsa_per_check`, × `pay_periods / 12`, per person, profile chosen by `effective_date ≤ 1st of m`
(latest wins). Sums are `Decimal`, quantized once at the API edge.

**Wire.** `MatrixOut` gains per-month arrays `living_total`, `tax_total`, `transfer_total`,
`cash_savings`, `payroll_savings`, `total_savings`, `total_savings_rate`; `savings_rate` KEEPS its
name and now means `cash_rate` (identical to today wherever every category is living).
`YearRollup` gains the same fields as scalars plus `months_matched` (months with both spend rows
and net pay) — its totals and both rates are computed over matched months only; `net_pay_total`
stays. `ProjectionOut.contribution_breakdown` reads the service (no arithmetic change), and
`annual_spend` derives from `living_spend` over the matched window of §3.

**Consumers.** Spending savings-rate chart: total rate as the line, cash rate as a second muted
line, legend words "Total (incl. payroll)" / "Cash". Spending yearly rollup: both rates, living
spend, tax paid, transfers as columns. Overview YTD card: headline total rate with the cash
figure beside it and both windows named. Projection Assumptions card: the breakdown already
printed, now sourced from the service. Assistant context: the same fields.

## 3. Coverage honesty

**Definition.** A spending month is *entered* when it has at least one non-zero amount OR a net
pay row for that month. A month with rows that are all `$0.00` and no net pay is *empty*. A month
inside the window with no rows at all is *missing*. The window is the balances coverage (first
snapshot month … latest snapshot month): balances are the ritual's anchor.

**Wire.** `CoverageOut` keeps `balances`, `spending`, `net_pay` (ascending months, unchanged
meaning for `balances`/`net_pay`; `spending` now lists ENTERED months only) and adds
`spending_empty: list[date]`, `spending_missing: list[date]`, `net_pay_missing: list[date]`, and
`latest: {balances, spending, net_pay}` (`date | None` each). One query per table; the endpoint
stays under `/coverage`.

**Consumers.**
- Overview footer / System card freshness: "Balances through Sep 2026 · Spending through Jul 2026
  (Aug missing, Sep empty) · Net pay through Jul 2026", amber when spending or net pay lags
  balances by ≥ 1 month.
- Attention (`attention.ts`): two new items from coverage — "August 2026 spending was never
  entered" (link to the wizard's spending step for that month) and "September 2026 was saved with
  no spending" (link to the wizard, which shows the §4 banner). The existing balances nudge is
  unchanged.
- Month ribbon: the spending dot lights only for entered months (empty months show the hollow
  ring); no CSS change.
- Health card: `check_zero_filled_spending` reads the same definition (shared helper), and gains a
  `spending_gap` sibling for missing months inside the window ("Enter it" link).
- Projection: `annual_spend` and cash savings both derive over the MATCHED window — the last 12
  months that are entered AND have net pay (today Aug 2025–Jul 2026 for both); the echo names the
  window (`derived_window: {from, to, months}`) and the Assumptions card prints it.
- Money flow: `MoneyFlowOut` gains `take_home_pending: Decimal` and `take_home_months_entered:
  int`. `take_home_pending = mean(net pay over the year's entered months) × (12 −
  months_entered)`, zero when 12 are entered; `retained_equity` subtracts it. The sankey draws a
  muted dashed node "Take-home not yet entered (5 months)" from gross beside take-home; the
  tooltip states the estimate rule. Production today: $6,373.09 × 5 = $31,865.43.
- Overview YTD card: every figure names its window — "Net worth since Dec 2025 (through Sep)",
  "Spend Jan–Jul", "Saved Jan–Jul (total / cash)" — and rates use `YearRollup.months_matched`.

## 4. Wizard decoupling

**Behaviour.** Each step saves its own half; a step you never touched writes nothing.
- Balances step → `PUT /net-worth/months/{m}` only. Snapshot created if absent.
- Spending step → `PUT /spending/months/{m}` only when at least one category amount is
  non-blank/non-zero OR net pay is entered, OR the user chose **Record this month as $0** (a
  checkbox under the grid, unchecked by default, with the sentence "Writes $0.00 for every
  category — use it for a month you truly spent nothing"). Blank categories inside a saved step
  are `$0.00`, exactly as today. Net pay alone saves the cashflow row and no category rows.
- Review step lists what each save wrote ("Balances: 26 rows. Spending: skipped — nothing
  entered.") and keeps the existing danger-zone month delete.
- Undo (change log) keeps working: each PUT is its own batch, as L2 already records.

**Server guard.** `SpendingMonthUpsert.confirm_zero: bool = False`. A body whose amounts are all
zero (or empty) with `net_pay` None and `confirm_zero` false → 422 `"Nothing to record: every
category is $0.00 and no take-home was entered — set confirm_zero to write an empty month on
purpose"`. The importer passes `confirm_zero=True` only for months that carry a net pay figure or
any non-zero amount in the sheet, i.e. never for a month the sheet does not have.

**Repair.** Visiting the wizard on an empty month shows a `FeedBanner`: "This month was saved
with no spending. Enter it below, or delete the empty month." The delete reuses the Health
action (`DELETE /spending/months/{m}`, balances untouched).

## 5. Derived parents

**Rule.** An account with at least one component (`accounts.parent_account_id = it`) has no
balance of its own: its balance for a month IS the sum of its components' balances that month.

**Server.** `PUT /net-worth/months/{m}`: for every parent with components, the stored balance is
set to Σ components from the SAME payload (missing component → its prior stored balance, else 0);
a submitted parent entry whose value differs from that sum → 422 `"{parent} is derived from its
components ({sum}); leave it out or send the components"`; a submitted parent entry equal to the sum
is accepted and ignored. `MonthUpsertResult` gains `derived: list[{account_id, balance}]`.

**Health.** `check_parent_component_drift`: any snapshot where a parent's stored balance ≠ Σ
components → severity error, months listed, fix = link to the wizard for the newest such month.
Production today: 0 months.

**Wizard.** A parent row renders read-only: the live sum of its component inputs, the prior
value and the delta, class `entry-derived`, badge "derived". Range paste skips it. The live
subtotal is unchanged (it already skips components).

**Settings.** Accounts card: a component's row says "component of {parent}"; a parent's row says
"derived: {n} components"; a component whose parent is inactive or missing gets an amber cue
("unlinked component — counts nowhere"). No schema change: `is_component` stays the rollup key,
`parent_account_id` the link; the PATCH that sets one without the other is refused with a 422
naming the other field.

**Export.** `finance-export.json` already carries `is_component` — the README's export section
adds one sentence: sum non-component rows for net worth.

## 6. Edge cases

- Kind change on a category with history: figures move retroactively; the Settings picker's
  helper text says so and the change is logged (L2 hooks cover `PATCH /categories`).
- A month with net pay but no category rows (net pay saved alone): entered; living spend 0 for
  that month in the service — flagged by a `spending_gap`-style Health note "net pay without
  spending" so it cannot masquerade as a frugal month.
- People without a profile in force contribute 0 payroll savings; a profile effective mid-month
  counts from the following month (1st-of-month rule).
- `net_pay = 0` rows: rates None (as today), savings computed.
- Parent with a component whose balance is missing from history months: the sum uses the stored
  rows that exist; the drift check reports, never rewrites.

## 7. Testing

- `services/savings.py`: table-driven unit tests over a three-category fixture (living/tax/
  transfer) with and without net pay; profile-in-force selection at month edges; Decimal
  exactness. Mutation checks: flipping a kind changes exactly the expected fields.
- Coverage: entered/empty/missing classification incl. a net-pay-only month and a zero month
  with net pay.
- API: `confirm_zero` 422 and accept paths; importer never trips it on the sample workbook;
  parent derivation accept/ignore/422; `derived` echo; Health drift rule on a seeded mismatch.
- Frontend: wizard per-step saves (no spending PUT when untouched), the checkbox path, the empty-month
  banner, derived parent row (read-only, live sum, delta), attention items from coverage, footer
  wording, YTD windows, sankey pending node conformance, Settings kind picker.
- Verify lane: full suites, `alembic check` on the dev DB after upgrade, two-theme smoke, and a
  before/after table computed on a copy of the production census figures:

| Figure | Before | After |
|---|---|---|
| FI target (4% SWR) | $1,644,478.50 (zero month in, taxes in) | $1,625,244.25 (living spend, matched months Aug 2025–Jul 2026: $65,009.77) |
| 2026 savings headline | −2.2% | Total +$30,159.46 (39.8%) · Cash −$996.98 (−2.2%) |
| April 2026 | $9,802.63 spend | $4,758.63 living + $5,044.00 tax |
| Footer | "Spending through Sep 2026" | "Spending through Jul 2026 (Aug missing, Sep empty)" |
| Money flow 2026 | take-home $44,611.60, rest in retained equity | + "Take-home not yet entered (5 months) ≈ $31,865.43" |
| Wizard 401(k) rows | 2 typed totals + 5 components | 5 components, 2 derived rows |

## 8. Lanes and merge order

| Lane | Scope | Files (hotspots in bold) |
|---|---|---|
| A | migration + `kind`; `services/savings.py`; coverage extension; matrix/yearly/projection/money-flow wire fields; health rules | **`api/spending.py`**, `api/coverage.py`, `api/projection.py`, `services/money_flow.py`, `services/health_checks.py`, `schemas/*` |
| B | `confirm_zero` guard; parent derivation in the balances PUT + `derived` echo; importer flag; Accounts PATCH consistency | **`api/spending.py`** (PUT only), `api/net_worth.py`, `importer/apply.py` |
| C | wizard per-step saves, checkbox, banner, derived rows | `pages/MonthlyUpdatePage.tsx` + test, `api/spending.ts`, `api/netWorth.ts`, `types/api.ts` |
| D | Overview footer/attention/YTD, Spending chart + rollup columns, Projection window echo, sankey pending node | `components/overview/*`, `pages/OverviewPage.tsx`, `pages/SpendingPage.tsx`, `components/spending/*`, `components/projection/*`, `charts/*` (fixture + conformance) |
| E | Settings Categories kind picker; Accounts card cues | `components/settings/CategoriesPanel.tsx`, `AccountsCard.tsx` |
| V | verify: suites, alembic check, smoke, before/after table, retire list (none expected) | — |

A and B both touch `api/spending.py`: A owns the GET side and services, B owns the PUT handler;
merge A first, B rebases. C, D, E branch from main after A merges (they need the new types);
B can start immediately. Implementers on `opus`, one combined review per lane, fixes re-verified,
local merges only, nothing pushed, deletions deferred (none expected).

## 9. Not in scope

Fixed/discretionary split, goals and milestones, employer-exposure tile, bracket staleness,
RSU vest stream in the projection, per-step undo beyond the change log, redesign of the review
step's danger zone.
