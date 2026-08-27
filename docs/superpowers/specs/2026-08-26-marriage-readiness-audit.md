# Marriage-Readiness Audit — Full-Dashboard Exploration

**Date:** 2026-08-26
**Status:** Exploration / brainstorm only — NOT an approved design. Nothing implemented. All
file:line references verified against the working tree on this date.
**Scope note (per request):** importer redesign is out of scope; the analysis assumes workbook
uploads are idempotent — update sheet-tracked values, leave everything else alone. (§9.1 flags
the two places where today's importer does *not* honor that assumption and would destroy
marriage data; those are prerequisites, not import features.)

---

## 1. Executive summary

The app is single-person by original design ("Single user (no registration, no roles, no
multi-account support)" — 2026-08-12 design spec §1). The good news from this audit: the
singleness is **not smeared everywhere**. It is concentrated in a small set of load-bearing
places:

1. **No person dimension on data.** The `users` table is an auth island — zero `user_id`
   foreign keys exist on any data table (`backend/app/models/user.py:9-15`). Ownership today is
   either absent (net-worth accounts), free text (`position_transactions.account`,
   `credit_cards.primary_holder`), or enforced-singular via unique constraints
   (`paycheck_profiles.effective_date`, `comp_events.focal_year`, `rsu_grants.label`,
   `espp_lots.purchase_date`, `espp_periods.label`).
2. **No filing-status concept anywhere** (grep for filing/married/spouse/joint across backend
   and src: nothing). Brackets are per-(year, jurisdiction) with single-filer values; ~40 tax
   input keys are flat per-year scalars.
3. **Payroll taxes computed on one combined wage figure** (`tax_service.py:312`) — the single
   worst *wrong-money* consequence of entering a spouse's W-2 today.
4. **One global employer** — `app_settings['espp_ticker']` does quadruple duty (ESPP pricing,
   RSU vest valuation, withholding vest legs, price-refresh scope).
5. **One income stream** — `monthly_cashflow` is `(month PK, net_pay)`; projection, sankey,
   savings rate, and paydays all hang off one stream.

**Recommended shape** (to be designed properly later): a `people` table (seeded with "Me";
partner added in Settings) + nullable `person_id` owner columns on person-scoped tables
(NULL = joint/household), **one shared login kept**, `filing_status` on `tax_years` +
status-dimensioned brackets + per-person payroll inputs, and a per-person employer/ticker
registry replacing the `espp_ticker` singleton. Every UI surface gets an All / Me / Partner
scope built from the existing segmented-control pattern.

Two distinct work categories emerged:
- **Correctness work** — married taxes computed right (per-person FICA caps, status-dependent
  thresholds). Without this, workarounds like putting the spouse's W-2 into `other_w2_income`
  produce silently wrong numbers (§4.2).
- **Household features** — partner accounts & ownership views, two income streams, household
  credit-card optimization, dual-career projection, marriage-planning tools.

---

## 2. The household foundation (cross-cutting)

### 2.1 People registry
- New table `people` (or `household_members`): id, name, short label/color for charts,
  `is_primary`, `employer_ticker` (nullable), `pay_cadence` fields as needed by later phases.
  Seed one row "Me" and backfill all existing person-scoped rows to it.
- The credit-cards spec already anticipated this: "No people registry" and "per-person
  filtering" are named deferrals in `docs/superpowers/specs/2026-08-25-credit-cards-design.md`
  (lines ~30, ~95).
- **Joint semantics decision (open question §10):** nullable `person_id` = joint/household
  (recommended — aggregation treats NULL as "counts for everyone", avoids a fake person row
  polluting per-person math) vs. an explicit "Joint" member row.

### 2.2 Marriage settings
- Settings gains a **Household** card: partner name, **marriage date**, default filing status
  going forward. Marriage date matters for: filing-status default per tax year (Dec-31 rule),
  the community-property snapshot (§8.4), and where per-person views begin to be meaningful.
- Hazard: `AppSettingsUpdate` is a rigid 3-field full-form PUT — a new key must land in
  `schemas/app_settings.py:15-21`, the router loop (`api/app_settings.py:127-131`), **and**
  `SettingsPage.tsx` `boxesFor` (:22-31) together or saves silently drop it. Household config
  probably deserves its own table/endpoint rather than joining that trap.

### 2.3 Global scope toggle (All / Me / Partner)
- Provider slot exists: `src/App.tsx:28-30` (`HouseholdProvider` beside `ToastProvider`;
  copy `ToastProvider`'s NOOP-default context so direct-render tests survive).
- Shell slot: `src/components/Layout.tsx:35-57` (between sidebar title and nav).
- Segmented-control precedent exists twice: `src/components/RangeChips.tsx:26-38` and the
  RewardsMatrix Multiplier|Effective% toggle. An All/Me/Partner chip group is RangeChips with
  three presets. `CommandPalette.tsx:70-105` can host a "Switch scope" action;
  its localStorage pattern (:23-37) is the only persisted-preference precedent.
- Default scope = All/Combined (household). Per-page owner filters thread through API `owner=`
  params (§3).

### 2.4 Auth: keep one login
- Recommended: **shared login** (household trust boundary; costs nothing today). A second user
  row currently *breaks the app*: `seed.py:15-23` renames `select(User).first()` — no ORDER BY
  — to `ADMIN_EMAIL` on **every boot** (`backend/start.sh:4`), so with two rows a
  nondeterministic one gets renamed and collides with the email unique constraint → boot 500.
  If a second login is ever wanted, fix the seed first; roles/user-scoping are NOT needed since
  data ownership lives on the person dimension, not the auth table.
- Related honesty gaps, fine to leave: password change doesn't rotate JWTs
  (`SettingsPage.tsx:461-465`, 24h expiry), per-IP rate limiting shares one bucket for two
  people behind one router, single-flight UI writes are last-write-wins (accepted single-user
  TOCTOU, `api/app_settings.py:126`) — two concurrent editors makes these slightly more real
  but still acceptable for a household.

---

## 3. Module-by-module findings & opportunities

### 3.1 Net worth & accounts — the user's #1 ask

**Current state.**
- `accounts`: name String(120) **unique**, slug **unique**, group (7 values, Python-side
  validation only), sort_order, is_active, is_component, parent_account_id
  (`models/net_worth.py:12-30`). No owner anything.
- **There is no accounts CRUD UI anywhere.** Backend CRUD exists
  (`api/net_worth.py:34,40,81,120`) but `src/api/netWorth.ts:16 createAccount` has zero
  callers. The roster is effectively fixed by workbook import — exactly the "net worth accounts
  are fixed" complaint. Same for spending categories (CRUD at `api/spending.py:47,86,125`, no
  UI). The 08-25 audit's "missing accounts/categories CRUD UI" finding is confirmed again.
- One household snapshot per month (`net_worth_snapshots.month` unique), balances additive-only
  (`PUT /months` never deletes, `api/net_worth.py:290-300`), no month delete (stated at :262).
- All rollups are group-only with no owner/is_active dimension: the single best math hooks are
  `net_worth_calc.py:42` (`net_worth_for`) and `:53` (`group_totals_for`), plus
  `investable_base`/`investable_bases` (:64/:91) consumed by projection
  (`api/projection.py:157`) and the spending 4%-line (`api/spending.py:299`).

**Marriage gaps & opportunities.**
- **Accounts management UI (prerequisite for everything).** A Settings (or Net Worth page)
  panel to create/edit/retire accounts — name, group, owner, sort, parent link. Note
  `parent_account_id` is currently unreachable via API (`schemas/net_worth.py:28-48` omit it),
  so a partner's 401(k) component nesting is SQL-only today. Also expose spending-category
  management while at it. [M]
- **Owner column on accounts** (`me|partner|joint` via `person_id` NULL=joint). Filter/group at
  the two math hooks and everything follows: timeseries `?owner=`, summary `owner_totals`
  beside `group_totals`, per-owner stacked view ("his/hers/ours"), tiles. [M]
- **Uniqueness collision:** name and slug are globally unique — only one "Checking" can exist.
  Partner rows need either suffixes (ugly, and re-imports warn about non-sheet accounts) or a
  composite unique `(person_id, slug)` migration. [S schema, touches importer natural keys]
- **Wizard:** partner accounts appear automatically once created (grid renders all active
  accounts, `MonthlyUpdatePage.tsx:197→380`) — group the grid by owner, subtotal per owner.
  Net pay stays one household field until P3 (§3.4). sessionStorage draft keys on month only
  (:69-73) — fine for a shared login, worth a note. [S]
- **Semantics quirk to resolve while in there:** an account with no balance row reads $0 in
  net worth (`net_worth_calc.py:49`) but null/gap in timeseries (`api/net_worth.py:165`) — two
  meanings for the same hole; partner accounts that start mid-history will hit this constantly
  (pre-marriage months genuinely have no partner balances). Decide: missing = "not tracked yet"
  (carry-forward or exclude) vs "zero". [S–M]
- **Chart scale:** drill palette caps at 8 accounts (`NetWorthPage.tsx:43`), tiles hardcode
  `['taxable','pre_tax','liability']` (:331), CSV export fixed 7 groups
  (`netWorthChartOptions.ts:71-82`), one flat chip row (:408-425). A doubled roster needs a
  visual pass. [S]
- Five hardcoded 401(k) component slugs (`importer/apply.py:217-224` + README "exactly five"
  check): a partner 401(k) with the same bucket names collides on slug; owner-scoped slugs or
  distinct names required. [note for design]

### 3.2 Taxes — the deepest work, and the wrong-money risk

**Current state (all confirmed, exhaustive):**
- No filing-status concept. Brackets per (year, jurisdiction, bracket_index), jurisdiction an
  unconstrained String(20) (`models/taxes.py:20,24`); values are single-filer (fed thresholds
  11000/44725…, CG 44625/492300, standard deductions 13850→16100, CA SD 5363→5706, one CA
  exemption credit 144→153).
- **Payroll on one combined figure**: `w2_income = latest_w2_income + other_w2_income`
  (`tax_service.py:312`) feeds Medicare (:313-318), Social Security with the wage-base cap
  applied ONCE (:325-331 — two earners share one cap → **understates SS tax**), and SDI
  (:333-334). The additional-Medicare 0.9% tier sits in bracket data at the **single/HoH
  $200k threshold** applied to combined wages (MFJ is $250k, MFS $125k → fires too early).
- NIIT is not computed — folded into stored CG bracket rates, with an advisory pinned to a
  hardcoded `NIIT_AGI_THRESHOLD = 200000` (`tax_service.py:51`, used :209,221,356-358).
- **Capital-loss cap absent**: `capital_loss_deductions` is a stored-but-unread key
  (`tax_keys.py:39`, deliberately not in `ENGINE_INPUT_KEYS`), `derive_suggestions:458`
  returns the raw netted loss uncapped — no $3,000 / $1,500-MFS anywhere (matches the 08-25
  audit finding; adding the cap is a behavior change vs pinned goldens, not a bug fix).
- Other hardcodes: `PAYCHECKS_PER_YEAR = 24` (:59), SALT cap 10000/40000 (:60-62) with **no
  MFS halving** and no >$500k-MAGI phase-down, safe-harbor `1.10` multiplier with the
  $150k/$75k-MFS AGI gate never checked (`api/taxes.py:566`), supplemental withholding rates
  (`withholding_calc.py:38-39`).
- Absent from the model entirely: CA mental-health 1% surtax over $1M (state rates stop at
  12.3%), CA renter's credit, MFS both-must-itemize rule.
- What-if sandbox: `POST /taxes/what-if` already accepts arbitrary input-key `overrides`
  (`schemas/taxes.py:132`, `tax_whatif.py:150-179`) **but the UI never sends them**
  (`WhatIfPanel.tsx` posts only `{year, sales, espp_sales}`); output shape is
  baseline-vs-one-scenario.
- Input keyspace: of the 43 keys, **17 are inherently per-person** (salary, W-2 set, 401k,
  HSA, pre-tax deductions…) and 26 are per-household (interest, dividends, itemized,
  LTCG…). Only ~6 per-person keys actually reach the FICA walks.

**Opportunities.**
- **Filing status, structurally** [L, the core]:
  - `tax_years.filing_status` (default `'single'` — history untouched);
  - `tax_brackets` + `filing_status` dimension, unique →
    `(year, jurisdiction, filing_status, bracket_index)`; thread through the bracket editor
    (status tabs above the six tables in `BracketsEditor.tsx:213-326`), the clone endpoint
    (currently clones one status' tables), and the single loader where selection becomes
    status-aware (`api/taxes.py:_engine_tables:139-157` — ripples to `money_flow.py:161`,
    `api/overview.py:125`).
  - `tax_inputs` + nullable `person_id`, unique `(year, key, person)`;
    `tax_input_definitions.is_per_person` flag; InputsForm renders a second column for
    per-person rows from the marriage year on (`InputsForm.tsx:221-287`; `flatItems` and
    paste-ids must become person-aware).
  - Engine: `compute_breakdown(..., filing_status)`; replace the scalar `w2_income` with a
    per-person list — `ss_tax = Σ walk(min(wages_p, base))` per person, same per-person SDI,
    additional-Medicare threshold from status-selected data. `JurisdictionResult` already has
    aggregate slots. Thread status into `niit_advisory` and `derive_suggestions` (SALT).
  - **Golden-test strategy:** the 795-line suite pins 2023–2026 single-filer outputs to the
    cent including deliberate sheet drift — the single-status path must stay byte-identical;
    MFJ/MFS gets new fixtures.
- **Statutory correctness items** (each small once status exists): additional-Medicare and
  NIIT thresholds by status; capital-loss cap 3,000/1,500 (behavior change — gate it);
  SALT MFS halving + phase-down; safe-harbor AGI gate; CA MHST (data-only: a 13.3% row above
  $1M in the state table — needs per-status tables anyway); MFS both-itemize rule;
  CA exemption credit × filer count. [S each]
- **Withholding tracker for two earners** [M]: `withholding_calc.estimate` is structurally
  single-earner (last-profile-wins :97-105, one cadence :98, FICA on one combined figure
  :114-121). Married version sums per person AND models the **additional-Medicare
  under-withholding trap**: each employer withholds the 0.9% only above $200k of *that job's*
  wages — two earners each under $200k but jointly over $250k get under-withheld every year.
  This tracker is where the dashboard can genuinely earn its keep post-wedding.
- **MFJ vs MFS comparison / marriage calculator** — see §8.1.
- **CA community property caveat** — see §8.4. An MFS calculator without Form-8958-style
  50/50 community-income splitting is wrong in California; fine to ship MFS-brackets-only
  first with an explicit caveat, but say so on the page.

### 3.3 Income & comp (paycheck, ESPP, RSU, focal history)

**Current state.**
- `paycheck_profiles.effective_date` UNIQUE (three enforcement sites) + "latest wins"
  `_default_profile` (`api/paycheck.py:233-265`) = structurally one salary stream.
- `comp_events.focal_year` UNIQUE = one employer's comp history. `rsu_grants` has no
  employer/person column (label unique).
- `espp_ticker` singleton read by ESPP pricing (`espp.py:143`), RSU vest valuation
  (`comp.py:36-39` — "the employer ticker is one setting, not one per feature"), withholding
  vest legs (`taxes.py:35`), and the price-refresh scope (`price_service.py:235`), with an
  `employer_backfill_floor` watermark keyed to it. A partner at another employer breaks all
  four at once or silently prices their RSUs at NVDA.
- ESPP is single-plan by construction: hardcoded two purchase periods/year with derived
  "Sep–Feb / Mar–Aug" labels (`espp_calc.py:172-212`), module-global `DISCOUNT = 0.85` (:30),
  offering resolution by date **across the whole table** (:109-127 — inserting a partner's
  offering would silently re-price the user's periods), $25k limit as one global accumulator
  per modeler run (:268, mirrored `EsppPage.tsx:44`).
- **No 401(k) elective-deferral, 415(c), or HSA limits exist anywhere** (verified by
  exhaustive grep) — the waterfall runs percentages past annual caps with no truncation or
  warning; only ESPP's $25k is modeled.
- Calendar paydays exist **only** when the single latest profile has
  `pay_periods_per_year == 24` (`calendar_events.py:170-186`; `business_days.py:77-83`
  hardcodes 15th + EOM); a biweekly partner gets silence. The tax engine separately hardcodes
  `PAYCHECKS_PER_YEAR = 24` (`tax_service.py:59`) even though the profile has a real column —
  already inconsistent for any non-24 profile today.

**Opportunities.**
- **Per-person paycheck profiles** [M]: `person_id` + unique `(person, effective_date)`;
  `_default_profile` becomes one-per-person; `/breakdown?person=`; PaycheckPage gets a person
  switcher; withholding tracker sums per person. Partner cadence: support biweekly (26)
  anchored on a stored first-payday — touches the calendar strategy
  (`business_days.semi_monthly_paydays` becomes one strategy among several) and the tax
  engine's derived-W2 suggestion (use the profile's real `pay_periods_per_year`). [M]
- **Per-person comp history & RSU grants** [M]: `(person, focal_year)` unique;
  `rsu_grants.person_id` + per-grant ticker; `_employer_bars`/`_espp_quote` take a ticker
  argument instead of the global setting; CompPage renders per-person trajectories (or a
  combined TC view — nice chart: household TC stacked by person).
- **Employer registry** [S–M]: move `espp_ticker` to `people.employer_ticker` (or an
  `employers` table if plans/tickers multiply); price-refresh keeps all employer tickers
  priced; Settings ticker box becomes per-person.
- **ESPP plan config** [M]: only if the partner has an ESPP (open question). Plan-scoped
  cadence/discount/periods + person-scoped lots/offerings/limit gauge. If the partner has no
  ESPP, just person-scope the existing tables and leave the plan shape alone. [defer until
  answered]
- **Contribution-limit registry** [M, high value]: per-person, per-year IRS limits (401k
  elective deferral, 415(c), HSA by coverage tier, IRA, ESPP $25k) as data, with YTD tracking
  from paycheck profiles + tax inputs, surfacing "on pace to hit / exceed / leave match on
  the table" per person. Marriage-specific rules worth encoding: HSA family-vs-2×self
  coordination, spousal IRA eligibility, Roth IRA MAGI phase-outs by filing status (MFS
  $0–10k kills direct Roth). This is new functionality the dashboard lacks even for one
  person — it just becomes twice as valuable married.

### 3.4 Spending, budgets, money flow

**Current state.**
- `monthly_cashflow` = (month PK, net_pay) — one cash number/month. Full consumer map traced:
  savings rate (`spending.py:224-227,366`), matrix/yearly/wizard, sankey take-home
  (`money_flow.py:181,199`), overview YTD (`ytd.ts:65-75`), projection default contribution
  (`api/projection.py:101-129`).
- **Structurally safe as a household total** — `net_pay` already means "cash that landed";
  a bigger total flows correctly through savings rate, sankey width, YTD, projection.
- Money-flow landmine: `SALARY_KEYS` deliberately omits `other_w2_income`
  (`money_flow.py:40-51`) so a spouse's W-2 entered there lands in the balancing
  `other_income` node; worse, adding spouse *cash* (net pay) without spouse *income* (tax
  inputs) makes `retained_equity` go negative and **the entire card refuses to render**
  (`NEGATIVE_RESIDUAL_REASON`, :79-82, :232-233). Income-side and cash-side must go married
  **together**.
- Spending rows are (month, category) totals — no payer dimension, by design. Budgets are
  (category, effective_month) — dashboard-only, never imported, safe to restructure.
- Sankey palette is out of free slots for a second source (`moneyFlowOptions.ts:33-43,121-126`).
- Adjacent gaps that get more annoying with two people: no month delete anywhere (mistyped
  month is permanent in every chart), categories undeletable once used (:125-139), savings
  rate has no coverage guard (half-entered months silently distort; chart clamps at −100%
  hiding it), cashflow-only months count as $0 spend at full weight in the 12-mo average.

**Opportunities.**
- **Recommended posture: household totals stay the spine.** Keep one spending matrix and one
  budget set. This matches how married finances actually get reviewed monthly and avoids
  Splitwise-creep (§7).
- **Second earner in the sankey** [S–M]: a labelled source node per person (new `SOURCES`
  entry + `MoneyFlowSources`/`SALARY_KEYS` fields + palette work), fed by per-person tax
  inputs from §3.2. Do this in the same phase as per-person tax inputs to keep the
  reconciliation invariant intact.
- **Per-person net pay** [M, optional]: composite key on `monthly_cashflow`
  (month, person) and three point-reads become SUMs. Buys: per-person savings-rate
  attribution, per-person payday reconciliation, cleaner sankey. Cost: wizard gets two fields,
  tri-state clear logic duplicated. Defensible to defer; household total is honest.
- **Shared-vs-personal categories** [S, optional]: a `scope` tag on `spending_categories`
  (shared / mine / partner's) used purely for grouping/summary ("personal spend: me $X,
  partner $Y, joint $Z") — zero change to the matrix grammar since categories are the axis.
  Cheaper and truer than a payer column on every cell.
- Fix-while-in-there: month delete endpoint + confirm dialog, savings-rate coverage guard
  (mirror money-flow's n/12 warnings), category archive/merge story. [S each]

### 3.5 Portfolio, prices, projection

**Current state.**
- `position_transactions.account` is free text String(80), `.strip()` only (case-sensitive —
  "Fidelity"/"fidelity" fold as two positions), **no join to net-worth accounts** (the one
  historical bridge, `accounts.suggest_source`, was dropped 2026-08-23). Holdings collapse to
  one row per security (`portfolio_calc.py:126-131`); allocation-by-account buckets raw
  labels (:223-241); dividends lose account attribution at holdings level.
- `portfolio_value_history`: one row per Monday, `snapshot_date` unique — whole-book only.
- **Contribution-matched benchmark reads cost-basis deltas as contributions**
  (`value_history.py:229`, seeded at parity :227). Merging a partner's holdings = one giant
  "contribution" that Monday — the VOO leg gets credited with the entire brought-in basis at
  that week's price, silently rewriting the comparison. Backfill also prices *today's* book
  into past Mondays (:293-309). `BASELINE_TICKER = "VOO"` hardcoded (:45).
- Projection/Monte Carlo: one contribution stream (trailing net_pay − spend), one FI target,
  one retirement event, SWR from settings (`api/projection.py:101-129,254-264`;
  `services/projection.py:29-51`; `montecarlo.py:55-88`).
- Securities/prices are genuinely owner-agnostic (shared reference data) — nothing to do
  there beyond the employer-ticker registry (§3.3).
- Quirks that bite on merge: XIRR suppressed whenever any dateless transaction exists
  (imported rows have none → merged book shows mostly blank XIRR); dividend auto-ingest
  self-heals per (security, account) so relabeling accounts orphans rows until next refresh,
  and manual-overlap suppression is keyed by security only (:132-137) — two spouses holding
  the same ticker in different accounts can have one person's manual row suppress the
  other's auto event.

**Opportunities.**
- **`portfolio_accounts` table** [M — the clean seam]: label (unique), `person_id`, optional
  FK to the net-worth `accounts` row; migrate `position_transactions.account` /
  `dividend_payments.account` to it. Fixes ownership, the case-sensitivity footgun, and
  finally bridges portfolio ↔ net-worth accounts (enables "this brokerage's market value vs
  its snapshot balance" reconciliation later). Cheap interim: an owner map keyed by label
  resolved in `load_portfolio` (`portfolio_calc.py:265`).
- **Owner filter on holdings/allocation/dividends** [S once the table exists]: filter in
  `load_portfolio`, an `owner` param on `/holdings` & `/allocation`; household-level
  concentration view is a genuinely new insight (both spouses concentrated in the same
  tech sector = household risk the individual views can't show).
- **Benchmark merge strategy** [decision needed, §10]: (a) enter partner history as dated
  backfill so the benchmark absorbs it as historical flows; (b) reset the benchmark start at
  merge date; (c) per-owner value-history series (breaks the snapshot_date unique — new
  dimension or read-time computation). Recommend (b) simplest + honest, with (c) as the
  eventual nice-to-have.
- **Dual-career projection** [M–L]: `project()` takes a list of contribution streams, each
  with amount, growth, and **stop month** (per-person retirement date), summed per month;
  same signature into Monte Carlo so the fan matches the line; FI target changes shape at the
  first retirement (household spend continues, one income stops). Inputs UI grows a second
  column. This is one of the most *fun* married features — "what if I retire at 45 and they
  work to 50."

### 3.6 Credit cards

**Current state.** Ownership is already free text ("holders are informational text —
single-user app", `models/credit_cards.py:22,38-39`). The optimizer is **already
household-shaped**: `optimize()` pools every active card with no owner concept
(`rewardsMath.ts:200-241`) — a partner's cards can be entered today and improve the answer;
the gaps are you can't see whose card won, `lineupNet` mixes both people's annual fees, and
per-person filtering was explicitly deferred in the spec.

**Opportunities.**
- **Owner tag on cards** [S]: `person_id` at the two column-enumeration sites
  (`api/credit_cards.py:380-393,318-339`), person select replacing the free-text holder
  input, owner badge in the matrix header. Watch the two verbatim full-object rebuilds in
  `CardsPanel.tsx` (:178-190 archive, :217-229 undo) — a new column omitted there silently
  clears.
- **Household optimization delta** [S, the payoff]: household `lineupNet` minus
  best-single-person `lineupNet` = "merging our wallets is worth $X/yr". Also: per-category
  winner annotated with owner; authorized-user strategy modeling (add partner as AU vs
  separate card — fee vs rewards) as a later nicety.
- Credit-line history inherits an owner filter for free via `activeCards`
  (`CreditCardsPage.tsx:102,185-191`); the `credit_limit_events` model comment already names
  mortgage/HELOC generalization — joint debt will want the same person/joint tag eventually.

### 3.7 Calendar & overview

- Calendar event types are hardcoded in triple-lockstep (`calendar_events.py:27-37`,
  `schemas/calendar.py:10-20`, `calendarView.ts:8-45`); `CustomEvent` has no person column;
  paydays are single-cadence (§3.3); one monthly-update reminder for one person
  (`api/calendar.py:141-147`). Married: person-tag on events, two payday cadences, partner
  vest dates, and person-colored dots. [S–M, mostly mechanical]
- Overview tiles read household aggregates already (fine); the YTD effective-tax tile and
  money-flow card change meaning with filing status (§3.2/§3.4); an owner-scope toggle makes
  the net-worth trend/tiles reusable per person. [S]

### 3.8 System status, backups — no person work needed
100% infra (`system.py:43-66`). Only note: household data doubles the value of the existing
nightly backup — no change required.

---

## 4. Wrong-money traps if used married *today* (why this matters now)

These are the workarounds a reasonable person would try before the retrofit, and what breaks:

1. **Spouse W-2 into `other_w2_income`**: FICA computes on the combined figure — one SS wage
   base for two earners (understates SS), additional-Medicare fires at single's $200k on
   combined wages (overstates), single-filer brackets/deduction overstate income tax for a
   typical MFJ couple. Every number moves, some up some down, all wrong. The sankey also
   dumps it in "other income".
2. **Partner net pay into the wizard**: savings rate improves and totals are honest, but the
   money-flow card goes negative-residual and **blanks itself** until the income side is
   also entered — which is trap #1.
3. **Partner accounts via API/curl** (no UI): works until a name collides with the unique
   constraint; every subsequent workbook re-import warns about non-sheet accounts; net worth
   mixes owners with no way to see whose is whose.
4. **Partner holdings into positions**: benchmark reads the merge as a giant contribution
   (silently rewrites the comparison), XIRR mostly blanks, holdings rows merge per ticker
   across owners.
5. **Partner cards into the roster**: actually fine today (free-text holder) — the one
   workaround that works.

---

## 5. Filing-status parameter reference (what the tax design must dimension)

Values below are TY2025 reference points from the statute/IRS as of knowledge cutoff — the
app keeps brackets as data, so exact values stay the user's job at entry time; the *structure*
is what matters here. ⚠ = statutory threshold that is NOT simply 2× single (penalty/trap).

**Per RETURN (need status-dimensioned data or engine rules):**
| Parameter | Single | MFJ | MFS | Notes |
|---|---|---|---|---|
| Ordinary brackets | data | ≈2× single except top ⚠ | half of MFJ | 37% MFJ threshold < 2× single |
| Standard deduction | 15,750 | 31,500 | 15,750 (0 if spouse itemizes ⚠) | stored input today, single values |
| LTCG/QDI stack thresholds | data | <2× at 20% tier ⚠ | half | stored in CG brackets today |
| Additional Medicare 0.9% | 200k | 250k ⚠ | 125k ⚠ | in bracket data at 200k today |
| NIIT 3.8% | 200k | 250k ⚠ | 125k ⚠ | hardcoded advisory today |
| Capital-loss cap | 3,000 | 3,000 ⚠ (not 6k) | 1,500 | absent from engine today |
| SALT cap (OBBBA) | 40k, phase-down >500k MAGI | same ⚠ (not 2×) | 20k | hardcoded 10k/40k, no MFS/phase-down |
| Safe harbor 110% gate | AGI >150k | >150k | >75k | multiplier exists, gate absent |
| CA MHST 1% | >1M | >1M ⚠ | >1M ⚠ | absent; expressible as a bracket row |
| CA standard deduction / exemption credits | data / 1× | 2× / 2× | half / 1× | single values stored today |
| Roth IRA phase-out | 150–165k | 236–246k | 0–10k ⚠⚠ | no IRA modeling today |
| Home-sale exclusion | 250k | 500k | 250k | future relevance (house) |
| Dependent-care FSA | 7,500 (2026, OBBBA) | 7,500 ⚠ household | 3,750 | future (kids) |

**Per PERSON (engine must apply per earner, then sum — never on combined wages):**
SS wage base (176,100); Medicare 1.45% base + per-employer withholding of the 0.9% tier
(the under-withholding trap, §3.2); CA SDI (uncapped since 2024 — note the sheet-derived data
carries a pseudo-cap row); 401(k) elective deferral 23,500; 415(c) 70,000 incl. after-tax;
HSA by coverage tier (family 8,550 vs 2× self-only 8,600 — coordination rule); ESPP §423
$25k per person per plan; IRA 7,000 + spousal-IRA eligibility.

---

## 6. Marriage-planning features (the pre-wedding suite)

1. **Marriage tax calculator** [M — flagship]: compute (single-A + single-B) vs MFJ vs MFS
   for a chosen year; the delta is the marriage penalty/bonus. The what-if sandbox is the
   natural host — `POST /what-if` already takes arbitrary overrides; needs `filing_status`
   in `WhatIfIn`, a partner-income input set, and a multi-scenario response shape (current
   is baseline-vs-one). Includes wedding-**year** timing: Dec-31 rule means "married in
   TY2026 vs TY2027" is a real, computable dollar figure.
2. **W-4 / withholding adjustment helper** [S on top of §3.2]: post-wedding both spouses
   should refile W-4s; project the additional-Medicare gap and the safe-harbor position for
   the wedding year specifically (the year status flips, prior-year safe harbor references a
   single-filer return — worth an explicit note in the tracker).
3. **Wedding budget** [XS–S]: a spending category + budget already models it; a calendar
   custom event + a goal line on the projection chart if desired. Explicitly cheap — don't
   over-build.
4. **Marriage-date balance snapshot / community-property marker** [S]: record each account's
   balance on the marriage date (a regular snapshot + a settings date covers 90% of it).
   California community-property context: pre-marriage assets + growth stay separate
   property; earnings after the date are community. Useful for MFS Form-8958 splitting,
   estate basis (double step-up on community property), and general record hygiene. A full
   separate/community characterization per account is possible later; the date + snapshot is
   the cheap durable primitive.
5. **Beneficiary/administrative checklist** [XS, maybe out of scope]: 401(k) beneficiaries
   (spouse becomes ERISA default), IRA/HSA beneficiaries, insurance, name changes. A static
   checklist card, or simply not this app's job — user's call.

---

## 7. Recommended non-goals

- **Multi-tenant auth / roles / second login** — the person dimension on data answers the
  actual need; auth stays one shared login. (Fix the seed footgun regardless, §9.2.)
- **Splitwise-style expense splitting / who-paid-what** — pre-marriage reimbursement
  accounting is a different product; post-marriage it's moot. Household totals + optional
  category scopes (§3.4) are enough.
- **Per-transaction spending ledger** — unchanged v2 deferral; marriage doesn't change it.
- **Importer redesign** — per instruction, out of scope; §9.1 prerequisites only. Partner
  data enters via UI (which is why the accounts/categories CRUD UI is a prerequisite).
- **Kids/dependents modeling** — not yet; but the people table + filing-status enum are the
  future-proofing (HoH, CTC, DCFSA, 529 all hang off the same primitives later).

---

## 8. Data migration & compatibility strategy

- **Backfill rule**: every existing person-scoped row → person "Me". All history is
  untouched; pre-marriage tax years stay `single`. Net-worth timeseries need no rewrite —
  partner accounts simply begin when their balances begin (resolve the $0-vs-gap semantics,
  §3.1).
- **Unique-constraint migrations** (each is a real migration, chained on head, never
  re-chained — README §4.3): accounts (person, slug); paycheck_profiles (person,
  effective_date); comp_events (person, focal_year); rsu_grants (person, label); espp_lots /
  periods / offerings person-scoped; tax_inputs (year, key, person); tax_brackets (year,
  jurisdiction, filing_status, bracket_index).
- **Golden tests**: single-status engine path stays byte-identical (the suite pins sheet
  drift deliberately); status parameter defaults `'single'`; new MFJ/MFS fixtures get built
  from a hand-verified reference year.
- **Sequencing insight**: taxes (§3.2) and money-flow/net-pay (§3.4) must move together;
  accounts/ownership (§3.1) is independent and can ship first; credit cards (§3.6) is
  independent and small; projection (§3.5) depends on per-person cashflow or explicit
  stream inputs.

## 9. P0 prerequisites (hazards to fix before any marriage work)

1. **Importer sync-delete scoping** — `apply.py:513-516` deletes any `tax_inputs` row in an
   imported year whose key isn't on the sheet; `:548-553` does the same for brackets. Any
   hand-added spouse inputs or MFJ bracket tables are silently wiped by the next workbook
   Apply. Scope both sweeps to the sheet's own vocabulary (precedent exists: rsu_grants,
   custom events, and credit-cards tables are already import-immune). This is also exactly
   the change that makes the requested "uploads update sheet values, leave the rest alone"
   assumption true. [S, high value, zero behavior change for current data]
2. **Seed determinism** — `seed.py:15-23` renames `.first()` (no ORDER BY) to `ADMIN_EMAIL`
   every boot; guard it (match by email, or order by id) so a second user row can never
   brick a deploy. [XS]
3. Account-label case folding / normalization decision before `portfolio_accounts`
   migration. [XS]

## 10. Open questions (blocking design, not exploration)

1. **Partner data depth**: backfill partner's financial history pre-marriage, or start
   tracking at (or near) the wedding? Drives the net-worth gap semantics and benchmark
   choice.
2. **Joint representation**: nullable person_id = joint (recommended) vs explicit "Joint"
   member? Will you actually have joint accounts (checking/brokerage)?
3. **Partner's compensation shape**: W-2? Which state (assumed CA)? Equity comp? ESPP (if
   yes, plan cadence/discount)? Pay cadence (biweekly?)? This sizes P3 substantially.
4. **Login**: shared login (recommended) or separate credentials?
5. **Spending attribution**: household totals only (recommended), category scopes, or full
   per-person net pay split?
6. **MFS depth**: brackets-only with a community-property caveat (recommended first), or
   full 50/50 community-income splitting?
7. **First married tax year**: 2026 or 2027? (Determines which year gets the status selector
   first and makes the marriage calculator concrete.)
8. **Benchmark on merge**: reset at merge date (recommended) vs backfill vs per-owner series?

### Answers (2026-08-26, user)

1. **Partner comp**: W-2, California (possible out-of-state move later — out of scope). No
   equity comp or ESPP today, but could materialize — person-scope the RSU/ESPP tables so a
   second person *can* attach later; build no plan-config or employer-registry now (YAGNI).
   Same semi-monthly paycheck cadence for simplicity — **biweekly/cadence flexibility dropped
   from scope** (revisit if it changes).
2. **First married tax year: 2026** (wedding in a few weeks). Makes the tax work
   time-sensitive: 2026 is the *current* year — the withholding tracker and W-4 adjustments
   apply immediately, and TY2026 flips single → MFJ with YTD single-assumption withholding
   already banked.
3. **Joint accounts**: at least one joint bank account; every other account has a primary
   holder with spouse as secondary. Ownership = primary holder; **nullable person_id = joint
   confirmed** as the representation (§2.1 decision closed).
4. **No historical backfill — start fresh.** Consequences: the benchmark-merge hazard (§3.5)
   is largely moot — partner positions enter as dated new transactions, which the benchmark
   correctly absorbs as contribution flows; no reset needed. Pre-marriage household totals
   correctly exclude the partner. The net-worth trend will show a real step at the marriage
   boundary — consider a marriage-date annotation on trend charts (design detail, not a bug).
5. **Spending: household totals only.** Per-person net-pay split de-scoped;
   `monthly_cashflow` schema stays as-is; wizard keeps one net-pay field (relabel to
   "household take-home").
6. **MFS: brackets-only with an explicit community-property caveat** on the page.

Resolved without asking (recommendations adopted into scope): employer-ticker registry
deferred until partner equity materializes; benchmark strategy = natural contribution flows
(consequence of answer 4).

Still open (asked 2026-08-26): login sharing; build order (P1+P2 batch vs taxes-first vs
accounts-first); MFJ bracket data sourcing (bring-your-own + clone helper vs app-seeded).

## 11. Suggested phasing (for later planning — not a commitment)

| Phase | Contents | Size |
|---|---|---|
| P0 | Importer sweep scoping, seed guard, label normalization | S |
| P1 | People registry + Household settings (marriage date), owner on net-worth accounts, **accounts & categories CRUD UI**, owner views on net-worth page + wizard grouping, global scope toggle | M–L |
| P2 | Filing status end-to-end: schema, engine per-person FICA + status thresholds, statutory items (NIIT/addl-Medicare/SALT/cap-loss/safe-harbor/CA items), TaxesPage status selector + per-person input columns + bracket status tabs, two-earner withholding tracker | L (the big one) |
| P3 | Per-person paycheck profiles + biweekly cadence + calendar paydays, comp events + RSU grants per person, employer-ticker registry, ESPP person-scoping (plan config only if needed), money-flow second earner | M–L |
| P4 | portfolio_accounts + owner filters, benchmark merge handling, credit-card owner + household-optimizer delta, calendar person tags, dual-career projection + Monte Carlo | M–L |
| P5 | Marriage tax calculator + wedding-year timing, W-4 helper, marriage-date snapshot, contribution-limit registry | M |

P1 alone delivers the user's headline ask (add and track partner accounts). P2 delivers
correct married taxes. Everything after is genuinely optional ordering.
