# Fresh-eyes dashboard audit — 2026-09-02

**Status:** ideas only, nothing implemented. Read-only pass over the whole app.
**Method:** every page walked in a headless browser against the dev database (37 monthly net-worth
snapshots Sep 2023–Sep 2026, 25 accounts, 19 spending categories through Dec 2025, 37 securities,
4 tax years, 6 credit cards, 2 household people), plus eleven parallel code audits (shell, Overview,
data entry/Settings, Net worth/Projection, Portfolio, Spending/Credit cards, Paycheck/Comp/ESPP,
Taxes, Calendar, AI assistant, chart system). Screenshots of every page and ~30 interactions were
reviewed. Out of scope by owner decision: mobile/PWA, transaction-level spending, realized gains/XIRR.

**2026-09-03 addendum:** the owner asked for the production server to be treated as ground truth.
Production runs the same commit but holds materially different data; §0b below records what was
verified there (read-only SSH census run by the owner, GET-only API pulls, and a second headless
page walk against `https://170.9.51.78`) and reclassifies every finding accordingly. Where §1–§12
describe a local-only condition, §0b overrides them.

Line numbers reference the tree at commit `2f86d83`.

---

## 0. Executive summary

The dashboard is unusually deep for a personal tool: thirteen pages, ~30 charts, a keyboard-first
monthly wizard, a full tax engine, Monte Carlo projection, a rewards matrix, a financial calendar
and an LLM assistant with tools. The engineering quality is high (server-owned math, tests
everywhere, explicit design decisions in comments). The leverage now is not more features in
isolation but three cross-cutting weaknesses that every area audit hit independently:

1. **It presents stale, missing or degenerate data with the same confidence as live data.**
   Spending/take-home lapsed nine months ago and nothing says so; "today" is printed on 19-day-old
   quotes; a provider outage is 36 "Deactivate" chips; the projection's contribution derives from
   stale months; the sankey draws missing take-home as retained equity; Partner/Joint scopes render
   all-zero pages. → Theme T1 (data-health layer) and T10 (empty-state gating).
2. **Several headline numbers people would act on are wrong or unreconciled.** FI date off by
   ~14 years because payroll-deducted savings are excluded from the contribution; "Will I owe
   $44.6k" built on unmodeled RSU withholding and unindexed 2025 brackets; two projection models
   21 years apart on one page; day-change off the wrong bar. → Theme T2.
3. **The grammar is fragmented** — four loading patterns, five selector patterns, two tooltip
   dialects, three window vocabularies, three deep-link conventions, per-page owner scope, dark
   only, palette hidden. → Themes T4 and T5.

After those, the biggest product wins are the monthly-ritual redesign (T3), planning sandboxes
that don't write to the database (T7), money-aware calendar (T8), assistant grounding (T9), and a
set of new visualizations the existing payloads already support (T6). Full ranked lists per area
are in §2–§12; the synthesis is §13.

---

## 0b. Production ground truth (verified 2026-09-03, 04:20 UTC) and reclassified findings

### What production actually holds
- **Deployment:** commit `2f86d83` (identical to local `main`), backend + frontend containers up,
  scheduler running on `10 13 * * mon-fri` America/Los_Angeles; the last five refreshes each updated
  36 tickers with 0 failures; next run Sep 3 13:10 PT. Nightly `pg_dump` to OCI succeeds (last
  Sep 3 03:00 UTC, 108 KB). Database 12.7 MB, alembic head `f7d3b2a91c40`, environment `prod`.
- **Household:** Edward (primary) and Grace; marriage date null. Edward owns every asset account;
  two joint accounts exist (Capital One 360 Checking at $0 and an Apple Card at −$40.62); Grace owns
  nothing. Three paycheck profiles (Edward ×2, Grace ×1 effective Sep 1 2026).
- **Coverage:** 37 net-worth snapshots through Sep 2026 (36 of 37 recorded on the 1st; zero notes).
  Spending rows exist for 36 months through **Sep 2026, but August 2026 has no rows at all and
  September 2026 is nineteen `$0.00` rows with no net pay** — the signature of the wizard's
  balances-only save (see §4 G3). Net pay (cashflow) runs through Jul 2026.
- **Populated in prod, empty locally:** 4 RSU grants (2,100-share new-hire grant + 400/502/425
  refreshes; next vest Sep 16 2026, 214 sh ≈ $48k; 1,605 sh ≈ $360k unvested), 90 dividend payments
  (Aug 2025–Sep 2026) and 168 ex-dividend annotations, 152 weekly value-history points
  (Oct 2023–Aug 31 2026), 2 ESPP offerings and 6 lots, 6 credit cards all with opened dates, limit
  events and linked liability accounts, 5 securities with an upcoming ex-dividend date.
- **Still empty in prod:** category budgets, contribution limits (all five 2026 caps null), custom
  events, snapshot notes, dated transactions (0 of 26). All four tax years are `single`.
- **Headline numbers:** net worth $806,667.88 (+$49,205.61 MoM); portfolio $764,662.79 as of Sep 1–2;
  dividends collected $7,186; 2026 tax $98,584.56 at 32.1% effective; withholding card projects a
  **$9,779.42 refund with safe harbor met** (vest leg modeled at $172.5k projected vest income);
  Projection shows FI target $1,644,478, FI ratio 44.7%, **projected FI date "—", "the FI target is
  not reached within the 30-year horizon"**, probability 66.6% (p10 Jun 2034, p50 Mar 2049), derived
  monthly contribution **$622.87**.

### Findings that were local-data artifacts (drop or demote)
| Finding as written | Production reality | Disposition |
|---|---|---|
| Quotes 19 days stale; 36 failed tickers; "Deactivate" chip wall; "today" on stale quotes | Prices fresh (Sep 1–2), 36/36 updated, scheduler running | Demote outage-aware status and stale-delta wording to low-priority robustness |
| Empty "Portfolio performance" card | 152 weekly points, full chart with events and live ping | Drop the empty-state complaints; keep the chart-mode ideas |
| Dividends tab empty; Dividends column all `$0.00`; KPI row hidden | 90 payments, 16 holdings with dividends, tiles populated | Drop; keep stacked-by-ticker and projected-months ideas |
| No RSU grants; vesting schedule empty; Taxes vest leg unmodeled ("$44.6k to pay") | 4 grants; schedule and calendar vests live; refund projected, safe harbor met | Drop the "$44.6k is wrong" claim; keep the *latent* warning (grants absent while W-2 RSU input non-zero) as low priority |
| ESPP offerings empty; modeler priced off the quote | 2 offerings; modeler clean | Drop the empty-state items; keep offering-bootstrap only as a first-run nicety |
| Cards without `opened_on`; none linked; "Total credit line" understated | All six have dates, limits and linked accounts | Drop; utilization-over-time and renewal calendar remain valid features |
| Spending lapsed nine months | Only August 2026 is missing (normal timing on Sep 2) | Replace with the phantom-September finding below |
| Comp TC chart cliff in the open 2027 year | No 2027 row in prod | Keep as a latent behavior, low priority |
| Partner scope all-zero | Grace still owns nothing (two joint accounts only), but has a paycheck profile | Keep empty-state gating; Paycheck/Calendar partner data now exist |

### Findings confirmed or made worse by production
1. **A phantom `$0.00` September 2026 spending month.** The Sep 1 balances update wrote nineteen
   zero spending rows and no net pay, while August spending was never entered. Downstream, in
   production today: the Overview Spending tile reads "—" for Sep 2026 and the footer says
   "Spending through Sep 2026"; the Spending hero reads `$0.00`; the 12-month average and the
   Projection's annual spend (and therefore the FI target) are diluted by a zero month; "What
   changed — Sep 2026" lists every category at −100%; the Housing trend line cliffs to zero; the
   heatmap gains an all-dark column; the recent-spending bars show an empty September slot and no
   August slot. This is the strongest single argument for §4 ideas 1–3 (decouple the wizard's
   halves, never write implicit zeros, coverage-aware reminders) and for a one-click repair
   ("this month has 19 zero rows and no net pay — mark as not entered").
2. **Projection pessimism is worse than the local snapshot.** Contribution $622.87/mo yields "not
   reached within 30 years" while Edward's profile alone routes ≈ $2,300 per check into 401(k),
   after-tax 401(k), ESPP and HSA (≈ $4,600/mo) and 2026 vest income is ≈ $172k, most of it
   retained per the money-flow card. The momentum chart on the same page crosses the target within
   a few years. §5 ideas 1–3 move to the top of the whole list.
3. **2026 bracket tables are 2025's.** Federal, state, Medicare, Social Security and capital-gains
   tables are byte-identical to 2025 in production (only SDI differs); the 2026 federal thresholds
   stored are the 2025 figures. §9 idea 2 (staleness badge + index helper) is confirmed.
4. **Credit cards are in an unconfigured state that reads as advice.** No reward category is mapped
   to a spending category and no annual-spend overrides exist, so every row says "no weight ·
   excluded from $ math", Optimal rewards is `$0.00/yr`, Net after fees is `$5.00/yr`, the
   worth-keeping chart shows one bar, and the page declares five of six cards "Droppable on these
   numbers … zero or negative net value after fees". The page needs an explicit setup state
   ("map categories or enter annual spend to turn on $ math") that suppresses verdicts until
   weights exist. The many-to-one double-count (§7 S1) will apply the moment the seed mapping is
   used.
5. **Paycheck add-profile form is pre-filled with the other person's profile.** Under Edward's chips
   the form shows Grace's $24,000 salary, 10% and 20%. Cause: the panel seeds its form once from
   the first payload (`useState(() => newProfileForm(latest))`, `PaycheckPage.tsx:286-288`) while
   `shownProfiles` is still unfiltered because the household has not loaded (`:938-943`), and the
   panel key (`selection.personId ?? 'primary'`) never changes for the primary, so no reseed
   happens. One "Add profile" with a date would create a wrong-salary profile for Edward.
6. **Money flow partial-year semantics.** The 2026 sankey draws full-year gross (from tax inputs)
   against 7 of 12 months of take-home; "Retained equity & other" absorbs the five missing months.
   The footnote ("net pay entered 7/12 months · spending entered 8/12 months") is honest; the visual
   is not. Needs a YTD-consistent basis or a muted "not yet entered" node.
7. **Calendar chip density is real.** Sep 16 carries four "RSU vest" chips (one per grant) for a
   single 214-share vest worth ≈ $48k that the chips never state; two people double the payday
   chips (16 in four months). §10 ideas 1 and 8 confirmed.
8. **Confirmed unchanged:** early-2023 net-pay artifacts still flatten two Spending charts; budgets
   and contribution limits empty (four identical "enter this year's limit" links live); notes
   unused; four `$0.00` account rows; joint "−$40.62" owner line; "Pay Periods" renders as
   `$20.00`; ESPP "Model sale" buttons truncated by horizontal overflow; "Taxes" exists as a
   spending category and is counted as spend ("Taxes (spending)" node in money flow); dark only;
   palette undiscoverable.

### Fixed on 2026-09-03 (uncommitted in the working tree at the time of writing)
- **Projection contribution** now derives as cash savings + every earner's payroll-deducted
  savings (401(k) traditional/Roth/after-tax, ESPP, HSA from the profile in force), echoes a
  `contribution_breakdown`, and the Assumptions card prints the arithmetic under the knob.
  Retirement drops remove take-home *and* that person's payroll savings. Local data: FI date
  Jun 2049 → Mar 2035; probability 76% → 99.8%.
- **Credit cards** treat "no weighted category" as a setup state: the two $ tiles read "—", the
  worth-keeping card explains how to set weights, no card is called droppable, and the drill-in
  tile stops judging. Shared spending categories are now split across the reward rows mapped
  to them (Travel → Flights/Hotels/Rental Cars is 1/3 each), and the Categories panel labels the
  split. The droppable sentence names how many rows it excludes.
- **Paycheck** profiles panel remounts once the household resolves, so the primary's
  carry-forward form seeds from the primary's own newest row instead of the partner's.

### Net effect on the ranking
T2 (headline math) and T3 (monthly ritual) rise above T1's freshness sub-items, because
production's prices, scheduler and backups are healthy while its *entered* data has a phantom
month and its planning figures are wrong. T1 narrows to coverage honesty ("entered" must mean
entered, not zero-filled; August missing must show). The credit-card setup state and the Paycheck
seed bug join the quick wins as concrete production defects.

---

## 1. What the browser walk showed (observations before reading code)

Rendering was clean on all fourteen routes (zero console errors except two 404s on `/paycheck`
for `GET /paycheck/breakdown?person_id=2`, the partner with no profile). Visual notes, page by page:

- **Login.** Minimal card, no show-password, no "session expired" state, no return-to-page.
- **Overview.** Two stacked amber banners (stale quotes, 36 failed tickers); four hero tiles where
  "Spending — Dec 2025" is nine months behind the net-worth tile yet styled as a live red KPI;
  a YTD strip that is four dashes out of five; an empty 160 px "Portfolio performance" card; a money
  flow sankey whose right half is missing (no take-home entered for 2026) but which draws the gap
  as a large purple "Retained equity & other" node; "Up next" is a plain text list dominated by
  paydays. Freshness footer lives below the fold. The assistant launcher is a small floating dot.
- **Monthly update.** Excellent keyboard-first grid, live footer total, Δ column. But step 2 seeds
  every category at `$0.00` and shows "−$2,030 vs typical" in *green*; the review step shows
  "Total spend $0.00" with Save enabled and a **Danger / Delete this month** block sitting in the
  middle of the save flow. Partner has no accounts, so the "ME" group header is the only one.
- **Net worth.** Owner segmented control whose Partner/Joint scopes render an all-zero page; a
  lonely "ME $799,395.50" line under the tiles duplicating the hero; the stacked area chart wastes
  its bottom third on a −$200K axis for a −$1.5K liabilities line; four `$0.00` account rows; a
  liability going from −$16 to −$33 prints "−100.0%" in red.
- **Portfolio.** A wall of 36 amber "TICKER · Deactivate" chips above the hero tiles (a provider
  outage rendered as 36 individual remedies); "today" delta on 19-day-old quotes; "as of Aug 14"
  repeated under 22 prices; XIRR column all dashes, Dividends column all `$0.00`; "Allocation by
  industry" treemap where the three cells are ETF / Information Technology / Mutual Fund; the
  price chart in the holding drill-in has no cost line or markers; transactions form + 26-row
  ledger inline on the analysis page.
- **Spending.** The first five months (Aug–Dec 2023) carry anomalous net pay
  (`$25,937 → $318 → $1,448 …`), so the net-pay line spikes to $30K and the savings-rate chart's
  axis runs to −1100%, flattening everything else. Heatmap is one linear blue scale dominated by
  Housing so 17 of 19 rows are indistinguishable. Budgets card is an empty state with 19 separate
  "Set budget" disclosures. Yearly rollup shows five all-zero categories.
- **Credit cards.** Strong matrix (best cell highlighted, Multiplier/Effective toggle, conditions
  marked), "worth keeping" bars, credit-line steps, per-card detail with credits and utilization
  placeholder. Two long CRUD forms live inline below the analysis.
- **Paycheck.** A 12-line waterfall list occupying the left third of an otherwise empty card;
  four identical "enter this year's limit" links in the pace strip; a stored withholding of
  `33.4009167%`; profile form with eleven boxes.
- **Comp.** Focal-history table overflows horizontally (last columns hidden behind a scrollbar);
  the TC chart's open 2027 bar collapses to base only, drawing a 69% "pay cut"; three empty
  states (grants, vesting schedule) and ~300 words of explanatory prose inside cards.
- **ESPP.** A single lonely `$25K limit used` tile in its own row; four qualified lots; an empty
  offerings card; a modeler priced off the latest quote with two amber warnings; the modeler table
  overflows horizontally.
- **Taxes.** A 5,845 px page: year chips, totals, jurisdiction table, waterfall, "Will I owe?"
  (`$44,585.60 to pay at filing`), marginal ladder, what-if (collapsed), composition trend, a
  44-row input form where "Pay Periods" renders as `$20.00` and "State Exempt Percentage" as
  `$0.95`, then six bracket tables with Add/Remove/Save each.
- **Projection.** Two charts that disagree by ~21 years on the FI date with only a hint sentence
  bridging them; a fan chart squashed into its bottom third; a derived monthly contribution of
  `$960.73` that a paycheck-literate reader immediately distrusts; two 12 px paragraphs of
  assumptions prose.
- **Calendar.** Sparse month grid (3 event types live: paydays, tax deadlines, ESPP); a
  four-line caveat paragraph; a list card that duplicates the grid; quick-add defaults to today.
- **Settings.** Nine cards in one column with Import first; System shows scheduler off, no backup
  recorded; contribution limits all "not entered"; assistant key + model.
- **Cross-page.** At a 1180 px window the hero values overflow their tiles (`$799,395.!`); the
  fifth KPI tile wraps alone. Dark theme only (a `prefers-color-scheme: light` probe renders
  identically). Ctrl+K palette works but is undiscoverable and matches page labels only.

---

## 2. Application shell & cross-page UX

### Friction & gaps
1. Cold start with a token is a blank screen until `/auth/me` resolves (`ProtectedRoute.tsx:6`, 15 s
   timeout in `client.ts:8`).
2. 401 → hard redirect to `/login` with no "session expired" notice and no return path
   (`client.ts:76-81`, `LoginPage.tsx:17,25`); 24 h token, no refresh; password change keeps old
   sessions alive (`SettingsPage.tsx:422`).
3. Palette (`Ctrl+K`) has no visible affordance anywhere and fuzzy-matches nav labels only
   (`CommandPalette.tsx:128`) — "rsu", "401k", "budget", "backup", "password" return nothing.
   Palette actions are half-actions: "Add dividend" selects a tab without scrolling; "Refresh
   prices" POSTs and navigates with no toast (`:83-86`).
4. Four loading grammars (PageSkeleton / SkeletonCard / bare "Loading…" / dimmed chrome), five
   "pick one of N" control grammars, three deep-link conventions, split success-feedback grammar
   (toasts vs inline notes vs a "Month saved" card).
5. Owner scope is per-page state with four CSS copies and four labels ("Whose money / card /
   paycheck"); not in the URL, not persisted; Overview has no owner scope at all although
   `/net-worth/summary` returns `owner_totals`.
6. Range preset defaults to **All** on every page and is never remembered.
7. Freshness lives only in Overview's below-the-fold footer; no page or shell element says
   "scheduler is not running" (`attention.ts` has no such rule).
8. Dark only (`index.css:4`); chart tokens are literal hex copies in `theme.ts:51-58`, so there is no
   bridge for theming. Type floor is 10–11 px in several places; `--negative` on surface is 4.56:1;
   `OTHER_SERIES_COLOR` is 2.16:1.
9. `InfoHint` is a `<button>` that does nothing on click, anchored `left:-8px` with no edge flip, so
   it clips at right card edges. Error toasts use `aria-live="polite"`.
10. No shell-level error boundary — a throw in palette/drawer/toast unmounts the app.
11. Any non-GET wipes the whole snapshot cache (`client.ts:36-39`), replaying skeletons and
    count-ups after routine edits.
12. Nav icons collide (two calendars, two line charts, a piggy bank for ESPP); no `:focus-visible`
    on nav links; sidebar has no identity, environment badge, or version.
13. `.stat-value` has no overflow handling → hero values clip in narrow desktop windows.

### Ideas (ranked)
1. **Shell status line** ("Snapshots through Sep 2026 · Spending through Dec 2025 · Prices Aug 14
   (stale) · Scheduler off"), amber when stale, click-through per clock.
2. **`PageFrame` primitive** owning header, error banner + Retry, stale cue, skeleton and dim so
   every page renders identical states.
3. **Session that respects the user**: sliding renewal, `returnTo` on 401, branded splash instead of
   `null`, "sign out everywhere" via a token version.
4. **Palette findable and complete**: sidebar "Search or jump… ⌘K" row, keyword aliases per
   destination, Settings cards as `#anchor` targets, lazy entity search (tickers, accounts,
   categories), finish the half-actions.
5. **Shared scope model** (`owner · range · month`) in one store mirrored to search params, one
   `<ScopeBar>`, Overview honors owner, default range 1Y.
6. **Month ribbon 2.0**: year dividers, today marker, ‹ › paging through all months, hover values,
   click = view, pencil = edit; two-tone chips (balances / spending).
7. **Keyboard layer + `?` shortcut sheet** (`g o`, `g n`, `[`/`]` month nav, `a` assistant).
8. **Themable tokens + density** with a CSS→ECharts bridge (`getComputedStyle` at init).
9. **Shell error boundary** with chunk-load detection, "Copy details", build hash.
10. **Tiered attention strip** with snooze, severity, a "scheduler not running" item, nav badge.
11. **Sidebar footer**: email, dev/prod pill, build hash; Log out in a menu.
12. **"Continue where you left off"** after login.
13. **Unified `<Segmented>`** control with correct ARIA per variant.
14. **Hero tiles with inline SVG sparklines** (12 points, no ECharts).
15. **Time-travel month selector** in the shell ("Viewing Mar 2025 — back to latest").
16. Toast semantics (error → `role="alert"`), edge-aware InfoHint popover, targeted cache
    invalidation, legibility pass (0.72 rem floor, `tabular-nums`, fix 3:1 graphics colors), login
    polish (show password, Caps Lock, 429 countdown), `min-width: 0` + `clamp()` on `.stat-value`.

---

## 3. Overview (landing page)

### Friction & gaps
1. **The biggest data lapse is invisible.** The update nudge inspects net-worth months only
   (`attention.ts:45-67`); spending and net pay stopped at Dec 2025 while balances run to Sep 2026.
   The Spending tile headlines a nine-month-old figure as a red KPI (`OverviewPage.tsx:401-408`); the
   footer's "Spending through Dec 2025" is never amber; the YTD card is four dashes; the sankey has
   no right half.
2. **The sankey relabels missing data as wealth.** `retained_equity = gross − taxes − pre_tax −
   take_home` (`money_flow.py:224`); with no net pay entered, a $181.8k residual (59% of gross) is
   drawn as "Retained equity & other" instead of "Unallocated (no take-home entered)".
3. **"today" on a 19-day-old quote** (`OverviewPage.tsx:391-397`) while the strip and footer call the
   same payload stale. Delta grammar differs across pages ("MoM" vs "vs prior month").
4. The header **Refresh** button beside "Quotes are stale" does not refresh quotes.
5. Two near-identical heroes (net worth $799k vs portfolio $773k) on different clocks with no
   explanation of their relationship (holdings exceed the snapshot's investable groups by ~$45k).
6. YTD anchor semantics are undocumented (Dec 1 balances vs Jan 1) and the largest YTD number
   changes by ~$38k depending on the rule; YTD has no same-point-last-year comparison.
7. 160 px dead "No performance history yet" card with no cause or fix.
8. Layout weight is inverted: four equal full-width cards, the slowest-changing element (annual
   sankey) is tallest, the most time-bound (Up next) is plain text at y≈1760.
9. Up next is 3/5 paydays; nothing quantified.
10. Tax tile is a bare level (no delta vs 2025, no marginal, no link).
11. Trend and bars carry no references (no average line, no budget step, no notes markers).
12. 13 requests / ~57 KB all-or-nothing fan-out; skeleton doesn't match real chrome.
13. No goals, milestones, streaks, or "since last visit"; net worth is **$604.50 short of $800k** and
    the page cannot say so.
14. No employer-exposure insight (NVDA 32% of portfolio, $120k RSU income).

### Ideas (ranked)
1. **Coverage-aware attention + data-health ribbon** (two-row MonthRibbon: balances / spending;
   amber spending footer; nudge "spending not entered since Dec 2025 (8 months)" →
   `/update?step=spending`).
2. **Honest stale delta + inline "Refresh prices"** ("−$1,068 on Aug 14", one merged price row with
   a working button and run outcome).
3. **Money-flow refusal or relabel** when take-home is unknown; default the chip to the latest
   complete year.
4. **"What moved" contribution bar** under the hero from `summary.groups[].mom_delta`.
5. **Goals, milestones, streak** (FI progress line from `/projection`, "$800K in $604.50", "37
   consecutive monthly updates").
6. **YTD → "Year so far vs last year"** with pinned anchor semantics, pace, and one sentence for
   absent facts.
7. **Two-column glance layout**: hero → trend (8) + right rail (attention, Up next, quick actions)
   → performance | spending → compact sankey.
8. **Spending bars with references and gap honesty** (12-mo average markLine, budget step, hollow
   placeholders for missing months that deep-link to the wizard).
9. **Performance card fallback** (monthly investable line from snapshots while weekly history
   accrues) and cause-naming empty copy.
10. **Employer-exposure insight** (NVDA holdings + qualified ESPP lots + unvested RSUs as % of NW).
11. Tax tile with context (Δ vs prior year, marginal, click-through) or swap for savings rate.
12. Up next: fold paydays, reserve slots for rare events, add amounts, extend window.
13. **"Since your last visit"** line, count-up only on changed tiles.
14. Server-composed `/overview/snapshot` (~10 KB, one failure domain, shared with assistant).
15. Trend annotations (notes, YTD anchor, next milestone) + hover sync with the "what moved" bar.
16. Contextual quick actions row under the header (the palette's actions, filtered by state).
17. Deterministic insight sentences (≤4 lines, `attention.ts` posture, each linking home).
18. Household-aware hero when more than one owner has money.
19. Skeleton that matches real chrome; sessionStorage snapshot for instant reload.
20. Per-card "as of" chips; retire the footer.

---

## 4. Data entry, monthly ritual, importer, Settings, data lifecycle

### Friction & gaps
1. **Half the ritual lapsed nine months ago and the app cannot notice** (reminder reads net-worth
   coverage only). Evidence suggests the 2026 snapshots arrived via the workbook importer, not the
   wizard (`recorded_on` always the 1st, zero notes, zero 2026 spending rows) — the parallel run
   with the sheet never concluded.
2. **The two halves are welded at save time**: no "save balances only"; saving writes 19 × `$0.00`
   spending rows (seed `'0.00'`, `MonthlyUpdatePage.tsx:278`, body at `:447-449`) which then read as
   a real $0 month everywhere; arriving via Spending's "Enter month" for a month with no snapshot
   writes copied balances as if real. The review step never says so.
3. **Components typed four times, never reconciled** (parent + 2–3 component children; no Σ check).
4. **Retiring an account with a balance creates a silent net-worth cliff** (`AccountsCard.tsx:171-179`;
   wizard drops the row; totals step down next month).
5. **Pre-fill hides forgetting** — untouched accounts save as "unchanged" and are celebrated in
   the counts card; no "N accounts identical to last month — did you check?" cue.
6. Manual sort integers, no drag reorder, no category grouping, no merge; renaming an account
   while the sheet keeps the old header creates a duplicate on re-import (slug immutable).
7. Undo/confirm posture is inconsistent across seven delete flows; accounts/categories delete
   with neither; month save has no undo; only Taxes/ESPP guard dirty navigation.
8. Save feedback vocabulary fragmented (card / inline note / toast / "Applied."); none says what
   changed in money terms.
9. Notes and `recorded_on` are dead weight (0/37 notes; date never displayed downstream).
10. Settings is a pile: nine cards, Import first, Password between App settings and Household; no
    appearance/locale/timezone/landing-page/notification/retention/session controls; the App
    settings PUT is a rigid three-field form (`schemas/app_settings.py:15-20`).
11. Import has no memory (report is ephemeral React state; 50-sample cap; confirm text mentions
    taxes only though transactions and value history also sync-delete).
12. Export is one-way — no restore path except `psql`; `finance-export.json` has no importer.
13. Smaller: net pay isn't a paste target; liabilities need a typed minus on five cards monthly;
    no "copy last month / fill typical"; wizard refetches eight endpoints incl. the full timeseries
    on every ribbon click; `?month=` unvalidated; step chips lack `aria-current`.

### Ideas (ranked)
1. **Coverage-aware reminders + two-tone ribbon** (fixes #1 without touching the ritual).
2. **Decouple the halves**: per-step save, explicit "Skip spending", review pills, never write
   copied balances or implicit zeros; "record as missing instead?" prompt.
3. **Month-in-review anomaly panel**: byte-identical accounts, |Δ| > 2.5σ, sign flips, normally
   non-zero categories at $0, blank net pay.
4. **Component reconciliation**: Σ components vs parent with "Use sum" chip; optional derived
   parent.
5. **Retire guard** dialog ("Zero it in Sep 2026 / Retire anyway / Cancel"), server `close_month`.
6. **Append-only change log** (`at, verb, table, key, before, after, batch`) → Activity card,
   per-month History, "since last apply" diff. Substrate for undo and import history.
7. **Undo for saves and month deletes** (re-PUT the baseline); harmonize delete flows.
8. **Import history + restore-from-export** (`POST /import/snapshot` over the app's own JSON).
9. **Settings information architecture**: sections + sticky rail (Household & roster / Preferences
   / Planning inputs / Automation & system / Security / Data), `?section=` deep links.
10. **Generic prefs endpoint** (`PATCH /settings/prefs`, key registry) — theme, currency style,
    liability sign convention, landing page, wizard default step, fiscal-year start, thresholds.
11. **Roster management**: drag reorder, category groups (Fixed / Variable / Discretionary),
    "Merge into…", rename warnings while the workbook is still a source.
12. **Spending-step accelerators**: Fill typical / Copy last month / Same as budget; `is_recurring`
    flag; blank-not-zero for variable categories; net pay chip + paste target.
13. Draft durability (localStorage, 14-day expiry, "Resume draft" on the chip, `beforeunload`).
14. Ritual scheduling (reminder day → Calendar/ICS, optional email digest).
15. Positive-liability entry mode.
16. Wizard load diet (`GET /net-worth/coverage`, prefetch on ribbon hover).
17. Backup controls in-app ("Verify last backup", retention/encryption status).
18. Keyboard & a11y polish (`aria-current="step"`, go-to chords, validated `?month=`).

---

## 5. Net worth & Projection

### Friction & gaps
1. **Projection's derived contribution ignores every payroll-deducted savings channel.**
   `_trailing_savings` = mean(net_pay − spend) = $960.73/mo (`api/projection.py:123-151`), while the
   live paycheck deducts ~$2,225/check (trad 401k, after-tax 401k, ESPP, HSA) ≈ $4,450/mo before
   net pay, plus employer match. Probing `monthly_contribution=5400` moves the FI date from
   **Jun 2049 to Mar 2035** and probability from 76% to 99.8%. The retirement "drop" ($6,768/mo)
   exceeds the $960 stream, so the Retires knob is numerically inert at defaults.
2. **Two models on one page, 21 years apart, never reconciled** (quadratic trend crosses the FI
   target ~Mar 2028; the model says Jun 2049; Monte Carlo p50 says Mar 2043). FI target isn't drawn
   on chart 1; only a hint sentence bridges them.
3. **Real-vs-nominal opacity**: defaults compound at 1.94% real, never displayed; "set inflation to
   0" isn't a consistent nominal model (target stays in today's spend).
4. **Ownership controls are degenerate**: Partner/Joint scopes render $0.00 everything with no
   empty state; "By owner" is one series identical to NW; "Retires — Partner" always 422s.
5. **Stacked chart wastes ~35% of height** on a −$200K axis for a −0.2% liabilities line.
6. Tiles chosen by hard-coding (Taxable / Pre-tax / Liabilities); Equity (31%, single-issuer
   employer stock) has no tile.
7. Percent-only change column (−$16 → −$33 prints "−100.0%" red); no Δ$, share-of-NW, owner, sort,
   hide-$0, sparklines; zero colored positive.
8. Quarterly refetches but the summary stays monthly → hero says "+5.5% vs prior month" while the
   tfoot says +11.7% QoQ.
9. No log scale, annual view, or MoM chart; `mom_pct` only as table text.
10. No contributions-vs-market decomposition; no milestones/goals anywhere (grep: zero hits).
11. Monte Carlo: 500 paths (±1.9% sampling error) shown to one decimal; p50 not drawn; null p90
    silently dropped; zero-anchored linear axis squashes the fan; no decumulation phase.
12. Assumptions UX: text boxes only, derived vs typed indistinguishable after seeding, no reset,
    no URL state, no save/compare, dense prose, cents on a $1.45M target.
13. No links between `/net-worth` and `/projection`; Projection never links Settings (SWR) or
    Spending (trailing spend); the 4% rule on Spending is the same math framed differently.
14. Net-worth charts lack `ariaLabel`; drill chart has no export; drill slot 0 blue collides with the
    Cash group blue; `recorded_on` never shown; notes layer has zero entries.

### Ideas (ranked)
1. **Derive the contribution from every savings channel** (net_pay − spend + each person's paycheck
   deductions × periods/12 + employer match), echo the channels, mini waterfall under the knob.
2. **Reconcile the two charts**: FI target on the trend chart, model path overlaid on a common basis,
   one-line strip "Momentum Mar 2028 · Model Jun 2049 · MC p50 Mar 2043", fade the quadratic past
   2× history, demote it below the model.
3. **Effective-assumptions readout** + explicit Real/Nominal toggle (nominal inflates the target too).
4. **Sensitivity tornado** (return ±2pp, contribution ±25%, spend ±10%, SWR ±0.5pp, inflation ±1pp,
   growth ±2pp → Δ months to FI).
5. **Scenario save/compare + URL state**, "Reset to derived", derived badges.
6. **Contributions vs market decomposition** (stacked monthly bars: cash Δ + estimated investment
   flow + residual market; cumulative "you saved $X · markets added $Y").
7. **Month-change waterfall by group** on click/hover.
8. **Milestones and goals** (auto round-number markPoints with dates; "Next: $1M ≈ mid-2027"; user
   goals as dashed rules on both pages).
9. **Fix the stacked chart's axis/liabilities** (`stackStrategy: 'all'` negative band or omit when
   < 1% of assets; `yAxis.min: 0`; log toggle).
10. **KPI row by materiality** (hero + 100% composition bar + employer-equity concentration tile).
11. **Table upgrades** (Δ$, share-of-NW, owner, inline sparklines, sort, hide $0, collapsible
    components, grey small percentages).
12. **Drill-down normalization** (indexed to 100 / % of NW) + optional small-multiples grid.
13. **Household empty states and gating** (one empty card per zero scope → Settings › Accounts; hide
    By-owner when < 2 owners; disable Retires — Partner without a profile).
14. **Monte Carlo presentation**: log-y toggle, p50 line, "≈76% (500 paths)" or 2,000 paths, always
    print p90, **reach-date histogram**, markLine at `fi_month`.
15. **Decumulation phase + retirement solver** ("earliest month with ≥90% success").
16. Annual/YoY views and calendar-year change bars by group.
17. Cross-page linking (FI ratio → Projection; Investable → Net worth; FI target → Settings/Spending;
    FI-ratio tile on Overview; publish knobs to the assistant).
18. Snapshot metadata & notes discoverability (`recorded_on` in tooltip; click month → wizard notes).
19. 100%-composition / streamgraph mode.

---

## 6. Portfolio & market data

### Friction & gaps
1. **A provider outage renders as 36 individual failures with 36 "Deactivate" remedies**
   (`PortfolioPage.tsx:522-541`, no cap; server filters by actionability, not pattern). Deactivating
   VOO would kill the benchmark leg. Nothing says "the provider answered nothing".
2. **"today" is 19 days old** (`:566-569`); the Day column has no date context.
3. **Day change picks the wrong prior bar** (`bars[-2]`, `portfolio_calc.py:168`): SGOV shows exactly
   0.0% because of a stray Sunday bar; VCX shows −10.6% off an outlier with no guard; `warnings[]`
   never fires for price anomalies.
4. **Holding price chart ignores adjacent data**: no avg-cost line, no buy/sell/dividend markers,
   although `rows`/`paid` are filtered right above it (`HoldingDetailPanel.tsx:116-123`).
5. **1Y/3Y/Max chips do nothing** — history starts at the first refresh (Aug 2025), all three windows
   return the same range, no explanation.
6. **Dead columns**: XIRR 22/22 dashes (undated imports), Dividends 22/22 `$0.00`, five weights print
   "0.0%"; no footer totals; concentration (NVDA 32%) is just a number.
7. Sort state dies on drill-in (table unmounts).
8. Treemap encodes one variable twice (size and shade) and mixes wrapper type (ETF / Mutual Fund)
   with GICS sectors because industry is free text; four slivers under 0.1%.
9. Donut folds a 9.6% account into "Other"; legend names slices without values; empty center.
10. Empty states mislead: "import your workbook" for a non-workbook user; the Dividends KPI row
    (incl. projected income $7,068) disappears when the log is empty; Partner/Joint say "add
    transactions below" when the fix is retagging an account in Settings.
11. Manual pricing cannot be dated in the UI (API supports `as_of`).
12. Free-text account fields mint accounts and owners on typos (`portfolio_accounts.py:29-41`).
13. Fifteen unheld securities are refreshed every run but invisible (no price column in Securities,
    no watchlist concept).
14. Refresh has no progress, no market-hours vocabulary; `next_run_at: null` silently drops the
    "next" clause instead of saying the scheduler is off.
15. No risk, correlation, exposure, or lot-age awareness despite ~255 daily closes per ticker and
    VOO held; `next_ex_div_date` never reaches the wire.

### Ideas (ranked)
1. **Outage-aware refresh status** (≥80% failed → one banner, hide Deactivate, refuse for the
   baseline ticker; decide server-side in `compose_refresh_status` so Overview agrees; render
   "scheduler not running").
2. **Honest staleness on every day-change surface** ("−$1,068 on Aug 14", "Day (Aug 14)", "19 days
   old"); prior bar strictly before the quote date; ±25% single-day warning.
3. **Reference-rich holding price chart** (avg-cost markLine, two-tone wash, dated buy/sell
   triangles, dividend circles, window return readout).
4. **Market-map treemap** (sector → ticker, area = MV, fill = diverging unrealized %; toggle day
   change; "Other" cell expands).
5. **Concentration and dust treatment** (inline weight bars, "Employer stock 32%" badge, "7 positions
   under $500" collapsible row, `<tfoot>` totals).
6. **Adaptive columns + persistent sort** (auto-hide empty XIRR/Dividends, Columns menu, group-by
   Account/Type with subtotals).
7. **Dated manual prices** ("as of" input; "last set $X on <date>"; "Log NAV" shortcut).
8. **Account picker with explicit "create account" path** in both ledger forms.
9. **Watchlist**: price/day/held columns + Held/Watching filter in Securities; per-security refresh
   toggle.
10. **Dividends tab that works with an empty log** (ungated KPIs, "Next ex-dividend: …", honest
    empty copy, "Next 12 months" projected strip).
11. **Dividend chart stacked by ticker with projected months** + same-month-last-year ghost.
12. **Risk & correlation from stored closes** (`GET /portfolio/risk`: vol, max drawdown, beta vs VOO,
    correlation heatmap).
13. **Performance chart modes** (Dollars | Indexed | vs VOO; drawdown strip; 3M/6M/5Y chips).
14. Honest empty performance panel (cause + fix; compact when < 2 points).
15. Price-history depth affordance (fetch once, zoom presets, disabled chips, "history since …").
16. Refresh progress + market-status pill ("Market closed · reopens Tue 6:30 PT").
17. Detail-panel prev/next (j/k), Weight, Day $/%, "Held since · long-term after".
18. Donut with value legend and live center.
19. **Asset-class + look-through taxonomy** (US / Intl / Bonds-Cash / Alternatives; per-fund weights).

---

## 7. Spending & Credit cards

_Authored from the browser walk, live API reads and the other auditors' cross-cutting notes; the
dedicated Spending/Credit-cards code audit had not reported when this document was written and
will be appended as an addendum if it lands._

### Spending — friction & gaps
1. **Early-history artifacts wreck two charts.** Aug–Dec 2023 net pay is `$25,937 → $318 → $1,448 →
   $1,590 → $1,590` (live `/spending/matrix`), so the net-pay line runs to $30K and the savings-rate
   axis to −1100%, flattening 29 months of real data. No outlier guard, no "partial month" flag, no
   axis clamp.
2. **Heatmap encoding is defeated by the data**: one linear blue scale from 0 to the global max
   (Housing $4.4k vs Bills $182 = 24:1) leaves 17 of 19 rows indistinguishable; the visualMap legend
   has no labels.
3. **Savings rate excludes payroll-deducted savings** (401k, ESPP, HSA never touch net pay) — the same
   blind spot as Projection; "Savings rate (actual) 32.8%" understates real saving.
4. **Budgets are an empty state with 19 one-at-a-time disclosures**; no bulk seed ("set all from
   12-month average"), no total-budget meter, no rollover, no variance chart.
5. **Category weights and every trailing figure are computed on months ending Dec 2025** (twelve-month
   average, "what changed", sankey, budgets) with no staleness cue on the page beyond hollow ribbon
   chips.
6. Yearly rollup shows five all-zero categories; no YoY %, no per-month average, no sparkline.
7. Category trends limit to three picks; no small-multiples view; no seasonality (month-of-year)
   view; no same-month-last-year ghost in the top chart; no inflation-adjusted or annualized
   run-rate reading.
8. No fixed / variable / discretionary classification, so the "where did the money go" question
   can't separate committed from discretionary spend, and the sankey folds everything to top-7 +
   Other.
9. "What changed" compares only vs prior month and 12-month average; movers don't link to the
   category trend; the panel follows the drilled month but the heatmap doesn't deep-link to it.
10. Heatmap cells don't link to the wizard for that month; the ribbon click always opens the editor
    (no "view this month").

### Spending — ideas (ranked)
1. **Data-quality guard**: per-month "partial / anomalous" flag settable from the wizard or the
   chart tooltip, excluded from averages and trends by default; robust axis (cap at p99 with a
   "clipped" marker). Immediately restores the net-pay and savings-rate charts.
2. **Row-normalized / log heatmap** with Row / Absolute toggle and labelled legend.
3. **Spending small multiples** (19 × 60 px sparklines, free y, shared x, budget dashed, 12-mo mean
   rule) replacing "pick up to 3".
4. **Budget bootstrap and tracking**: "Set all from 12-mo avg / 3-mo median / last year +3%", a
   total-budget vs total-spend meter in the hero row, variance bars, rollover option, group budgets.
5. **Category groups (Fixed / Variable / Discretionary)** used by the wizard, the sankey (grouped
   flows), a "discretionary run-rate" tile, and budgets.
6. **Unified savings definition**: show *cash* savings rate and *total* savings rate (adds payroll
   deductions from the paycheck profile) side by side; share the service with Overview/Projection.
7. **Seasonality and YoY**: month-of-year average panel per category; prior-year ghost bars on the
   top chart; "vs same month last year" column in "What changed".
8. **Yearly rollups upgrade**: hide all-zero rows, YoY %, monthly average, inline sparklines, and a
   **category rank bump chart** across years.
9. **Anomaly sentences** ("Travel $810 is 3.9× its 12-month average") derived deterministically;
   reused by the wizard's review step and the assistant.
10. **Stale-weights cue**: "trailing 12 months ending Dec 2025" chip on the hero and matrix weights;
    amber when the spending feed trails the balances feed.
11. Real-dollar toggle (inflation knob shared with Projection) and annualized run-rate tile.
12. Cross-links: heatmap cell → drilled month (view) and → wizard (edit); movers → category trend;
    ribbon click = view, pencil = edit.

### Credit cards — friction & gaps
1. **"Net after fees" reads higher than "Optimal rewards"** ($3,401 vs $3,326) because it silently
   adds recurring credits; the label hides the composition.
2. **Nothing date-shaped exists**: `opened_on` is NULL on all six cards; no fee month, no credit
   reset cadence, so no anniversaries, fee postings, credit expiries or 5/24 dates can reach the
   Calendar or the attention strip.
3. **Utilization is a placeholder** ("Link a liability account…"): no card has a linked account, and
   even when linked only the latest month is computed (`CardDetail.tsx:74-93`).
4. **All card economics are client-side** (`rewardsMath.ts`), so the assistant, exports and any
   digest cannot cite card values.
5. Recurring credits have a "Counts ✓" valuation toggle but no *used this year* tracking or expiry.
6. Category weights derive from spending months ending Dec 2025 (stale) with no cue.
7. Two long CRUD forms (roster, categories) sit inline under the analysis; roster shows no account
   age, no archived history, "Opened —" on every card.
8. The matrix has no runner-up context (how much the best card wins by), no frozen first column at
   narrower widths, no "why" math in a tooltip.
9. No sign-up-bonus / spend-threshold tracking, no points balances, no card templates for adding a
   common card, no "what if I cancel X" scenario.

### Credit cards — ideas (ranked)
1. **Card economics as stacked signed bars** (marginal rewards + credits − fee, net as marker) and
   relabel the tile "Net value (rewards + credits − fees)".
2. **Eventize cards** (`opened_on`, fee month, credit reset cadence → fee postings, credit expiries,
   anniversaries, 5/24 clears on the Calendar and attention strip); nudge for missing `opened_on`.
3. **Credits tracker**: per credit "used / remaining this cycle" with expiry; "unused credits $X
   expiring in 30 days" tile and calendar chips.
4. **Utilization over time** from linked liability balances (per-card and total, monthly), plus a
   utilization tile once any card is linked; one-click "link to account" from the roster.
5. **Server-side `/credit-cards/values`** (port `rewardsMath`) for the assistant, exports and a
   `best_card_for(category, amount)` tool.
6. **"Which card?" quick lookup** in the palette and on the page (type a category → best card, rate,
   condition, runner-up delta) and a compact printable wallet card.
7. **Scenario toggles**: "if I cancel Venture X" / "if I add card X" recomputes optimal rewards and
   net; a small template library for common cards.
8. **Matrix polish**: runner-up delta on hover, "why" math tooltip, effective-% color ramp, frozen
   first column, collapse hidden categories, per-person filter already present → per-person totals.
9. **Sign-up bonus tracking** (threshold, progress from mapped spending, deadline → calendar).
10. **Points balances & valuations** (optional per-card balance × point value → "unused rewards $X").
11. Move CRUD into collapsible "Manage cards / Manage categories" sections or a drawer; show account
    age and archived cards' history.
12. Stale-weights cue shared with Spending (idea 10 above).

### §7 addendum — findings from the dedicated Spending/Credit-cards code audit (landed later)

**Spending — additional gaps**
- **S1. The optimizer's headline dollars are inflated by many-to-one weight mappings.**
  `resolveWeight` (`rewardsMath.ts:363-373`) hands *each* reward row the *full* trailing-12 spend of
  its mapped spending category. Live: Travel is counted 3× (Flights, Hotels, Rental Cars), Food &
  Dining 2×, Shopping 2×, Auto & Transport 2× — roughly +30% on "Optimal rewards (est.)", "Net after
  fees", every marginal value and the matrix footer. The Categories panel repeats the same
  "auto · trailing 12 mo" figure on each mapped row with no hint of double counting.
- **S2.** Savings-rate y-floor rule `Math.min(-1, Math.floor(extent.min))` (`SpendingPage.tsx:496`)
  makes the default view span −1100%…+100% because Sep–Dec 2023 net pay is $318–$1,590.
- **S3.** No `is_active`/zero filter on heatmap rows, trend chips or the yearly table
  (`SpendingPage.tsx:849, :919, :416-429`); five all-zero rows occupy ~26% of the heatmap.
- **S5.** The budget editor's default effective month is the *focused* month (`BudgetPanel.tsx:44-49`)
  — a first budget saved today is past-dated to Dec 2025.
- **S6.** Budget histories exist only as PUT echoes (`BudgetPanel.tsx:38-40`); there is no history GET
  though the resolver exists (`spending.py:148-159`).
- **S7.** The top-7 fold is frozen to all-time totals (`SpendingPage.tsx:197`) regardless of the
  range window; the CSV export mirrors the fold — no full-matrix export.
- **S8.** The legend name `'4% rule'` and InfoHint wording hard-code a number over a configurable
  `swr_pct`.
- **S9.** Single-month KPIs are noisy (Dec 32.8% vs Nov 12.4%); trailing-12 rate only in the yearly
  footer; no run-rate, YoY, or per-person attribution (`MonthlyCashflow` is one household number).
- **S10.** Trends card has both a chip picker and a legend toggling the same series; the savings
  card's InfoHint and drill-hint repeat the same sentence.
- **Category semantics leak everywhere**: `SpendingCategory` has no fixed/discretionary/transfer
  kind, so "Taxes" and "Investments" categories are counted as spend in the savings rate, both
  sankeys and presumably Projection's spend assumption.

**Credit cards — additional gaps**
- **C1.** Owner chips render for any two-person household; the Partner scope's empty state says
  "add a card below" instead of "Partner holds no cards".
- **C2.** 0 of 6 cards are linked to a liability account although five matching accounts exist
  ("VentureX CC", "Savor CC", "BILT CC", "RH CC", "Active Cash CC"); linking is a manual dropdown
  in a nine-field form with no name-match suggestion; utilization copy leaks the storage convention
  ("balances are stored negative").
- **C4.** `CardCredit` = label, annual value, counts — no cadence, no "used this period", no
  remaining-to-claim.
- **C5.** Only 2 of 6 cards have limit events, so "Total credit line" understates by construction
  with no backfill nudge.
- **C6.** 79 filled cells of mostly "1x" bury the winners; the `⁺` condition marker relies on a native
  `title` on a `<sup>`; winner-ness is color+bold only; the pin-honoring `primaryCardId` verdict is
  never shown in the matrix.
- **C7.** "Droppable" is a strong claim from a narrow model (Robinhood Gold loses every category to
  Venture X → $0 marginal); non-category value has nowhere to live.
- **C8.** Redundant Owner/Holder columns; annual fee as a sub-line in the name cell; "+ Add card"
  focuses a form at the bottom of the page with no highlight.

**Additional ideas (ranked within this addendum)**
1. **Split shared weights across mapped reward rows** (equal split or `share_pct`), show "⅓ of
   Travel · $X" in the weight cell, and a reconciliation line "Weights total $Y/yr vs $Z/yr real
   trailing-12 spend". Corrects the four headline numbers on the page.
2. **Savings-rate robust axis + "Saved $" twin** (clamp at −100% with clipped markers; dollar bars
   immune to tiny-denominator blow-ups).
3. **Dormant-category folding** ("Show 5 dormant" toggles; chips sorted by trailing-12 spend).
4. **Heatmap modes: Absolute / Row-normalized / vs 12-mo avg** (the last as a diverging ramp centered
   at 0 — the anomaly view the page lacks; needs a validated diverging ramp in `charts/theme.ts`).
5. **Budgets first-run + always-on history** (history GET; one editable table with a Suggested column
   from `typicalSpend`; "Use suggestions for top 7"; default effective month = max(focused,
   current)).
6. **Cumulative budget variance & optional rollover** (YTD envelope vs YTD actual; `rollover` flag
   as a running sum in `_resolve_budgets`).
7. **Staleness + run-rate KPIs** ("Spend — Dec 2025 · 9 months behind"; annualized run-rate tile;
   trailing-12 savings rate with the latest month as the delta line).
8. **Year-over-year comparison** (Δ vs prior year and $/mo avg columns; YoY hollow markers on bars;
   ghosted last-year line on trends).
9. **Seasonality small-multiple** (Jan..Dec × year mini-heatmap; seasonal median feeding the
   wizard's "Typical" column).
10. **Category kind: fixed / discretionary / transfer** (Settings editor; group-by-kind toggle;
    "Discretionary spend" KPI; exclude transfers from savings and sankeys).
11. **"Where the saved money went"** — second sankey leg reconciling Σ(net pay − spend) against the
    net-worth delta by account group with an "unexplained" residual node.
12. **Card renewal calendar** (`fee_month` or derive from `opened_on`; "Renews Mar · $395"; Calendar
    events; inline nudge for the six null `opened_on`).
13. **Credits as trackable perks** (cadence + per-period used marks; "Credits this year: $170 of
    $470 claimed"; page-level "Unclaimed credits" tile; worth-keeping uses *claimed*).
14. **Matrix polish pass** (dim base-rate cells; ★ glyph in the best cell; a "Use" column showing the
    pin-honoring primary card; focusable condition hint; weight as its own column with an inline
    bar; sequential tint in Effective % view).
15. **"Which card for…" quick lookup + per-card "reach for it when" list** from `wonCategoryIds`.
16. **Auto-link cards to liability accounts** (fuzzy-match roster names to account names, one-click
    "Link VentureX CC?" chips), Utilization and Next-renewal columns, "Total utilization" KPI,
    inline "Add opening limit" for cards with no events.
17. **Owner-scope gating** (chips only when ≥2 distinct owners hold active cards; honest empty copy).
18. **Soften "droppable" + optional `keep_reason`** ("Kept for: credit age").
19. **Full-matrix CSV + window-aware top-7 fold** (recompute over the visible window; reassign palette
    slots only on chip change).
20. **Movers with sparklines** (12-month inline SVG per mover row; "since last year" column).

---

## 8. Paycheck, Comp, ESPP

### Friction & gaps
1. **No what-if mode on Paycheck** — every experiment is a database write (create a dated profile,
   read, delete). No sliders, no side-by-side.
2. **Per-check only**: no annual gross/withholding/net, no effective rate, no payday grid; 26-period
   profiles average away 3-check months; the calendar refuses any cadence but 24; two payday
   generators disagree (`withholding_calc.check_dates` vs `business_days.semi_monthly_paydays`).
3. **Withholding % is a black box** (all-in fed+state+FICA *of taxable*, labelled just
   "Withholding %"); the stored `33.4009167%` was back-solved by hand; no stub-derivation helper.
4. **Rigid deduction schema** (eleven lines; no medical premium, no generic other, no bonus, no
   employer match, no employer HSA).
5. **Pace strip repeats four identical CTAs**, lands on `/settings` with no anchor, and projects "at
   today's %" only — never YTD, so it cannot say "you hit the cap in October". Live 13% × $188,930 =
   $24,560.90 elective deferral is almost certainly over the 2026 cap and nothing says so.
6. **Two "ESPP limit" concepts contradict** (pace row compares contribution dollars to a user cap;
   the modeler measures shares × subscription vs a hard-coded $25,000).
7. **ESPP modeler is silently wrong until offerings exist** (falls back to the $225 quote against a
   $48.51 real subscription price; two amber sentences); no "create offering from lots"; completed
   periods never hand off to a lot.
8. Lots table omits the qualifying date and any if-sold-today ordinary/capital split (the engine
   already computes it in `tax_whatif.decompose_espp`); "Price" repeats the same quote; no totals;
   "unqualified" vs Taxes' "disqualified".
9. **TC chart mixes a stock with a flow and cliffs in the open year** (equity segment = entire
   unvested balance + whole refresh; 2027 bar = base only → 69% visual pay cut). No bonus field.
10. Grants first-run is below the fold and half-seeded (refresh grants only; new-hire grant must be
    typed; June 3rd-Wednesday assumption unstated); no reconciliation of focal `unvested_rsus` vs the
    computed schedule.
11. Vesting view lacks today/cliff markers, cumulative line, past/future distinction, sell-to-cover
    estimate, price sensitivity, forfeiture view, employer concentration.
12. Stale quote (Aug 14) rendered "not judged" on both pages.
13. No person dimension on Comp/ESPP tables (two-earner household cannot enter partner equity).
14. Consistency: confirm() vs undo-toast deletes; missing `ariaLabel`/export on TC, vesting, sankey;
    vesting chart replays entrance on cached revisits; `$25k` tile far from the modeler;
    `hsa_coverage='none'` with a non-zero HSA accepted silently.

### Ideas (ranked)
1. **Paycheck "Try it" sandbox** with slider+box pairs, debounced server breakdown with overrides,
   "Compare to current" split with per-line deltas, "Save as profile effective ___".
2. **Per-check / Monthly / Annual segmented waterfall** + annual tiles (gross, withholding w/ rate,
   net).
3. **Contribution-limit max-out helper with YTD anchor** (per-year "YTD contributed as of <date>";
   progress + projection; "cap reached in October — N checks of missed match"; "set Y% to land in
   December"; one CTA → `/settings#limits`).
4. **Reconcile the ESPP limit across pages** (rename pace row; second line from `run_modeler`; one
   statutory constant).
5. **Offering bootstrap from lots + period→lot handoff** ("Add offering — $48.509 from ~Sep 2023
   (covers 4 lots)"; "Record purchase as lot").
6. **Lots table: qualifying date, if-sold-today split, totals**; consistent vocabulary/formatting.
7. **Real annual TC** (base + vests that year + bonus) and demote the balance chart; omit or hatch
   open years; `target_bonus` column.
8. **Vesting calendar upgrades** (today markLine, cliff markers, hatched future, cumulative line,
   chart↔table hover, cache-gated animation).
9. **Price scenario strip** (−30% / quote / +30% / custom) re-pricing Comp and ESPP tiles.
10. **Sell-to-cover and net shares per vest** (rates already in `withholding_calc.py:43-44`).
11. **"Golden handcuffs" forfeiture view** (leave-date picker, per-grant progress rings).
12. **Grants first-run flow** (top-of-page onboarding card, new-hire chip with cliff/rounding
    defaults, drift check vs focal history).
13. **Withholding % from a pay stub** helper + relabel "All-in withholding % of taxable pay" +
    reciprocal links with the Taxes will-I-owe card.
14. **Flexible deduction lines** (medical, other pre/post-tax, employer match %, employer HSA).
15. **Pay calendar for the year** (12-cell strip; 3-check months; profile-in-force bands; one payday
    model shared with Calendar/withholding).
16. **Per-person Comp and ESPP** (`person_id` on events, grants, lots, offerings, periods; per-person
    ticker; household roll-ups).
17. **ESPP contribution optimizer** (solve the % that lands on $25k with zero refund).
18. Consistency pass (one delete idiom; `ariaLabel` + export on all charts; one stale-quote rule;
    move the $25k tile next to the modeler; HSA coverage warning).

---

## 9. Taxes

### Friction & gaps
1. **The headline withholding answer is almost certainly wrong and the card cannot know.**
   `w2_stock_rsus_sold = 120,000` for 2026 but there are no RSU grants → `vest.income_projected = 0`
   and no supplemental withholding is modeled; 22% + 10.23% + 2.35% on $120k ≈ $41.5k ≈ the entire
   "$44,585.60 to pay at filing". No warning fires for "W-2 RSU input non-zero, grants empty".
2. **The primary's actual withholding cannot be entered** — `w2_fed_withholding` /
   `w2_state_withholding` render as editable for person 1 but are read only for partners
   (`api/taxes.py:1039-1041`); no key for estimated payments made.
3. Two competing "how far into the year" counters (`pay_periods` 20 vs `checks_elapsed` 16); the
   `/24` hardcode ignores the profile's cadence.
4. **Bracket tables carry forward unindexed and nothing notices**: 2026 federal, state, SS and CG
   tables are byte-identical to 2025 (IRS 2026 figures differ: 12% floor $12,400 vs stored $11,925;
   SS wage base $184,500 vs $176,100); CA SDI still has a $300k cap row though the cap was removed
   in 2024. The clone is verbatim, no "identical to prior year" flag, no index helper.
5. Marginal panel stops one step short: fed TI is $221 below the 35% floor and nothing says so;
   ordinary income only, no capital-gains lane.
6. What-if shows Δ total/take-home only although the server returns seven per-jurisdiction deltas
   (NIIT missing from `WhatIfDelta`); one scenario at a time; run error drops the prior result; no
   presets; override select lists 40+ raw snake_case keys.
7. **Input form is a sheet transcript**: no W-2 box mapping, three giant sections, every cell a money
   `AmountInput` so `unq_div_state_exempt_pct` reads **"$0.98"** and `pay_periods` reads **"$20.00"**;
   suggestion chips compare raw 4-dp strings so a permanently "suggested" row appears beside an
   identical value.
8. Standard-vs-itemized decided silently (itemized $29,824 vs standard $16,100 — never shown); no
   state itemized deduction (CA filers with SALT-heavy federal itemizing frequently itemize on CA).
9. Coverage gaps undisclosed (no AMT, credits, phase-outs, CA mental-health surtax, HoH); a fully
   populated year reads as complete.
10. Multi-year comparison is one chart + a donut drill-in that adds nothing.
11. Cross-module pre-fill is thin (only `annual_salary`), despite dividends, ESPP lots, RSU
    candidates, and partner profiles being tracked.
12. No outbound links; `?whatif=` doesn't scroll; "Delete year…" beside "Create year"; no current-year
    marker; `TaxYear.notes` dead; clone review badges vanish on tab switch.

### Ideas (ranked)
1. **Reconcile the withholding card against the inputs it ignores** (RSU-without-grants warning;
   read the primary's entered withholding as an override "entered from paystub"; add an
   `estimated_payments` key; source sub-labels on the tiles).
2. **Bracket-table staleness + index helper** ("unchanged from 2025 — indexed figures usually move";
   "Index from prior year by X%" with IRS rounding; per-table "verified" toggle; SDI cap flag).
3. **Bracket headroom + capital-gains lane** ("$221 from the 35% bracket"; 0/15/20 stack lane;
   "next $1,000 of LTCG costs …").
4. **Stacked income ladder** ("where each dollar was taxed": ordinary by bracket, LTCG/QD on top,
   NIIT threshold markLine, deduction as hollow base).
5. **What-if side-by-side and decomposition** (baseline | scenario | Δ per jurisdiction + NIIT;
   diverging bar; keep last result on failure).
6. **Scenario presets and pinning** ("Max 401(k)", "Max HSA", "Sell all NVDA", "Realize gains up to
   the 15% ceiling", "Roth conversion $X"; 2–3 pinned columns).
7. **Return-shaped input form** (Wages per person with W-2 boxes / Investment income / Other /
   Adjustments / Federal deductions with live "itemizing wins by $13,724" / State / Withholding &
   payments; annualization mode switch; `kind="percent"|"plain"` for non-money rows; cents-level
   suggestion compare).
8. **Pre-fill from the rest of the app** (dividends, ESPP sold lots via `decompose_espp`, vests,
   partner profile) with provenance chips.
9. **Year comparison table + small multiples** of the waterfall.
10. **Standard vs itemized + bunching helper** (both totals, winner, SALT cap applied, two-year
    bunching estimate).
11. **Refund/owe headline on the summary tiles** (projected balance + marginal on the first screen).
12. **Filing-status comparison** (MFJ vs two Singles once tables exist).
13. **State itemized deductions** in the CA chain.
14. **Coverage disclosure panel** (what the engine models / doesn't).
15. **Harvesting hints from holdings** (positions by unrealized G/L → one-click sale legs; "$X of
    15% room").
16. Deep-link polish and outbound links; current-year chip marker; kebab for Delete; surface
    `notes`; filing-status badge per chip + wedding divider.
17. Waterfall hygiene (drop $0 bites, add "Pre-tax deductions" bite, label effective rate).

---

## 10. Calendar

### Friction & gaps
1. **Three of nine sources are dormant and the UI cannot tell "nothing announced" from "pipeline
   dead"**: ex-dividend dates are fetched only inside the successful-price branch
   (`price_service.py:117-120, 150-165`), all 37 tickers failed, `ex_div_fetched/failed` counters are
   dropped by `schemas/system.py:46-53`; the caveat prose ("a quiet stretch may simply be
   unannounced") masks a broken feed. RSU vests empty while three seed candidates exist.
2. Labels are built for ICS UID identity, not chips ("Tax deadline — Q3 estimated payment" in a
   1/7-width ellipsis cell); no `title` on hover.
3. Add-event defaults to *today* (not the viewed month), refetches the current month, never
   navigates to the saved date; palette "Add custom event" only navigates.
4. ICS export churns (`update_due` UID embeds today's date → duplicates) and a one-shot PUBLISH
   can never retract; export silently includes the previous month.
5. **A financial calendar with no money** (schemas explicitly "no money fields") although net pay
   per check, ESPP contribution per period, vest values and safe-harbor shortfall are all computed
   elsewhere.
6. Up next is payday noise (3/5 rows); type order alphabetical.
7. Static caveat prose instead of InfoHint; the list card duplicates the grid on desktop.
8. Data the app holds is not eventized: card fees/credit resets/anniversaries (`opened_on` NULL on
   all six cards), contribution-cap crossing dates, bank holidays, state tax deadlines, extension
   flag, loan due dates, age milestones (no birthdate on `Person`), dividend pay dates.
9. Derived vs stored ESPP periods look identical; person tag stamped into `label` and peeled client-
   side; no "+N more" overflow; one month per click with no month picker or `?month=` URL state;
   custom events lack amount/category/recurrence/done.

### Ideas (ranked)
1. **Money on events + weekly cash-flow strip** (`amount`, `direction`; per-week "+$6.8k in / −$395
   out"; 45-day net on Overview).
2. **Recurrence, category and amount for custom events** (rrule-lite, server-side expansion, native
   `RRULE` in ICS).
3. **Eventize credit cards** (fee posts, credit resets/expiries, 5/24 clears; nudge for `opened_on`).
4. **Source-health footer and dormant-source CTAs** ("Ex-dividends: last fetched never — refresh
   failing"; "RSU vests: 3 grants ready to seed → Comp"; "Partner: no profile → Paycheck").
5. **Filters, person toggle, URL state** (`?month=&types=`).
6. **Agenda view** ("Next 90 days" grouped by week with money subtotals; paydays folded).
7. **Click-a-day quick-add, viewed-month default, land-on-save**; wire the palette to `?add=1`.
8. **Chip grammar and overflow** (`short_label`, hover title, "+N more", same-type collapse,
   priority ordering).
9. **Subscription feed** (`/calendar/feed.ics?token=`; `X-WR-CALNAME`; `VALARM`; stable UIDs).
10. **Holidays + projected/confirmed distinction** on the grid.
11. **Tax-deadline intelligence** (safe-harbor verdict on estimated-payment chips; "federal" in
    labels; extension flag; CA installment layer; Apr 15 = IRA/HSA deadline).
12. **Contribution-cap events** ("401(k) maxes out on check 22, Nov 13"; "enter 2027 limits").
13. Dividend pay dates + past ex-div history for symmetric scrolling.
14. Mark-done / dismiss for deadline-type events (acks keyed by UID).
15. Forward year strip (MonthRibbon grammar, event-count dots) for navigation.
16. Motion polish (popover fade, direction-aware grid slide, new-chip pulse).

---

## 11. AI assistant

### Friction & gaps
1. **The "Model a sale" sample cannot be executed correctly**: `run_tax_whatif` requires
   `security_id` but the portfolio bundle drops it (`assistant_context.py:258-273`) — the model must
   guess an integer; the engine will model whichever security that id names.
2. **Samples ask for numbers the context doesn't carry** ("Cite the estimated yearly values" for
   cards, but all card economics are client-side in `rewardsMath.ts`).
3. **Page-context blind spots**: Projection knobs, Calendar's visible month, Paycheck person, ESPP
   modeler inputs, Comp focal year are never published; Overview attention is client math.
4. The question's context is captured (`contextLabel`) but never shown, and only the *current*
   page's bundle is in the system prompt — a follow-up from another page silently swaps ground truth.
5. **Cost and latency are opaque**: full bundle (~15 KB+ for portfolio) re-shipped every turn, no
   `max_tokens`, no usage, no logs; a 75 s read timeout can eat the 90 s budget on one rung.
6. **The rate-limit countdown never fires for the app's own limiter** (`headers_enabled` off →
   no `Retry-After`; the drawer offers "Retry with <other model>", which cannot help an IP limit).
7. Tables in a 400 px drawer have no scroll wrapper.
8. No per-message copy/regenerate/edit/feedback; history head-sliced (drops conclusions).
9. One session-only conversation; "New chat" wipes without confirm.
10. Tool-result truncation is all-or-nothing (>20k chars → nothing useful).
11. Privacy is consent-once (sentence in Settings only); no payload preview or controls.
12. No global hotkey; three presets repeat identically on every page.

### Ideas (ranked)
1. **Make every tool argument formable from what the model can see** (`security_id` in holdings;
   accept `ticker`/`lot_id`; test asserting every required id is in some bundle).
2. **Server-side card economics** (port `rewardsMath`; `/credit-cards/values`; `best_card_for` tool).
3. **Publish the missing view state** (Projection knobs, Calendar month, Paycheck person, ESPP
   inputs, Comp focal year) and honor it in builders.
4. **Stamp and carry the asked-against context** (muted line under each user bubble; "Now looking at
   Portfolio" divider; per-message note to the model).
5. **Verified-figure highlighting** (post-process answer literals against context/tool numbers;
   underline unverified with "not found in your data").
6. **"Ask about this chart"** ✦ in `ChartExportMenu` with a prefilled prompt and `view.focus`.
7. **Natural-language what-if → Taxes sandbox** (extend the `?whatif` URL grammar; tool chip
   "Open in What-if →").
8. **Structured, allow-listed citations** (`[[/spending?month=…|Spending · Dec 2025]]` → internal
   Link chips only for NAV paths).
9. **Cost/latency instrumentation** (`max_tokens`, `include_usage`, "Kimi K3 · 8.2 s · 11.4k tokens",
   structured log line, skip re-sending unchanged bundles, "Lite context" toggle).
10. **Fix the app-level 429 path** (`headers_enabled=True`; hide model-switch on app 429).
11. **Persistent multi-thread history** (opt-in; auto-titles; confirm before wipe; export).
12. **Per-answer actions and feedback** (copy, regenerate, edit-and-resend, thumbs → JSONL eval seed).
13. **Proposal tools with human confirmation** (`propose_budget`, `propose_calendar_event`,
    `propose_month_entry` return diffs; the browser performs the existing PUT/POST on Confirm).
14. **Natural-language monthly update** ("checking 12,340; rent 2,400" → wizard draft, nothing saved
    until the user clicks Save).
15. Follow-up suggestion chips.
16. Drawer ergonomics (resize, push mode, hotkey, compact model badge).
17. Narrow-drawer tables (scroll wrapper, right-aligned numerics, sticky first column, expand).
18. **Answer-embedded mini charts** (validated ```chart blocks through the house `EChart`).
19. Privacy controls (first-run consent in-drawer, payload preview + size, pseudonymize names).
20. On-demand "Month in review" card on Overview (cached per month, regenerate, thumbs).

---

## 12. Chart system (cross-cutting)

Inventory: 30 ECharts mounts + SVG sparklines + 3 HTML meter families; zoom on 9, export on 6,
zoom-hint on 9, `ariaLabel` on 14 of 30, legend persistence on 5 of 11, cross-chart linking 1
(heatmap→bars), `echarts.connect` 0.

### Friction & gaps
1. **Two tooltip dialects, no ordering** — ten charts use the default renderer, six hand-build HTML
   in three micro-grammars; no `tooltip.order`; bar charts keep the *line* axisPointer.
2. **Same-axis siblings don't align or link** (Net worth pair differs by 60 px `grid.right`;
   Spending trio shares a window but not the pointer; `connect` unused).
3. **Heatmap scale defeated by the data** (linear 0→global max; 24:1 row ratio → 17 of 19 rows
   unreadable).
4. Legends at `top: 0` over fixed `grid.top: 40` collide when they wrap; no `legend.type: 'scroll'`.
5. **Three motion clocks**: CSS 120/180 ms, count-up 350 ms, ECharts defaults 1000/500 ms —
   `FINANCE_THEME` carries no animation keys; `REDUCED_MOTION` frozen at module load in `EChart`.
6. Projection rebuilds both charts on every keystroke (unmemoized builders,
   `ProjectionPage.tsx:354-359`); legends reset on Recalculate (no `onLegendChange`), same on the tax
   trend.
7. Band-legend quirk is fixable (name both washes identically).
8. The projection draws the target but not the arrival (`fi_month`, p10/p50/p90 in payload, not on
   chart).
9. Annotation coverage thin and page-local (no focal years, vests, ESPP purchases, "today" on the
   vesting chart; `MarkArea` unregistered).
10. Accessibility half-applied (16 of 30 mounts nameless incl. net worth and portfolio performance;
    `AriaComponent`/decals unregistered; no keyboard path to values other than CSV).
11. Export uneven and thin (six charts; PNG omits title/date; no copy-to-clipboard).
12. Paper cuts: full-currency axis on card values; three window vocabularies (All/1Y/YTD vs
    1Y/3Y/Max vs 1/5/10/40Y); range state per page; treemap double-encoding; stale comment in
    `motion.ts`.
13. Duplication: `AxisTooltipParam` ×5, `roundTo` ×4, bar emphasis pair ×6, compact axis formatter
    ~×20, grid literal ~×8, chart-header CSS ×4; ~350 lines of inline options in `NetWorthPage` and
    `SpendingPage` despite the stated "*ChartOptions law".

### Ideas (ranked)
1. **`src/charts/grammar.ts`** (`MONEY_GRID`, `moneyAxis()`, `monthAxis()`, `BAR_MARKS`, `roundTo`,
   `cents`, `makeAxisTooltip({groups,totalLabel,shareOf,referenceNames,unit})`); move inline
   options into builder modules with tests.
2. **Unify the tooltip contract** (bold date header → rows ordered valueDesc for stacks → Total →
   reference rows; `shadow` axisPointer on bars).
3. **House motion block in the theme** (450/300 ms, `cubicOut`/`cubicInOut`, 12 ms stagger on
   stacks; live `matchMedia` for reduced motion shared with StatTile).
4. **Link and align same-axis siblings** (`echarts.connect` groups; equal grid insets).
5. **Fix the heatmap encoding** (row-normalize or `log1p`; Row/Absolute toggle).
6. **Mark arrival on the projection** (FI and coast markLines, post-FI markArea, p10/p50/p90
   markPoints; rename band series; memoize; persist legends).
7. **Holdings heat-treemap** (industry → ticker; diverging unrealized %; click → drill-in).
8. **Spending small multiples** (19 × 60 px area sparklines, free y, shared x, budget dashed).
9. **Net-worth MoM bridge + Share % mode**.
10. **Price chart with context** (avg-cost rule, markers, wash).
11. **Legend focus and isolation** (`emphasis.focus: 'series'`, double-click solo, scroll legends).
12. **Accessibility pass** (`ariaLabel` required in TypeScript; `AriaComponent` decals; "Table" in
    the ⤓ menu).
13. **Export everywhere with a caption** (`{option, csv}` from builders; title/subtext at PNG time;
    Copy to clipboard).
14. Vesting time semantics (today rule, hatched future, cumulative INK line).
15. One window vocabulary, persisted (All/YTD/1Y/3Y in sessionStorage).
16. Indexed compare mode (rebased to 100) on drill-down and category trends.
17. Table-row → chart highlight everywhere the heatmap→bars recipe applies.
18. Card economics stacked bars + utilization over time from linked liability balances.
19. Category rank bump chart across years.
20. Tile sparklines + dividend YoY ghost bars.

---

## 13. Highest-leverage themes (synthesis)

Ranked by user impact per unit of effort. Each theme bundles ideas from several areas above.

### T1. A data-health layer the whole app reads from
_(Re-scoped after the production pass — see §0b. Prices, scheduler and backups are healthy in
production; the problem is coverage honesty of entered data.)_ The app renders missing or
zero-filled data with the same confidence as real data. In production a phantom `$0.00` September
spending month makes the footer say "Spending through Sep 2026" while August was never entered;
the money-flow residual absorbs five months of missing take-home; the projection derives from a
diluted trailing spend. Build one coverage model (balances, spending, net pay, prices, scheduler,
backup, dividends feed) in which "entered" means at least one real value, surfaced as: a shell
status line, two-tone month ribbon chips, coverage-aware attention items with snooze/severity,
per-card "as of" chips, and a one-click repair for zero-filled months. Outage-aware refresh status
and stale-delta wording remain as robustness items, lower priority than before.

### T2. Fix the headline math people will act on
_(Now the top theme — production confirms the worst case.)_
- Projection's contribution ignores payroll-deducted savings and retained vests. In production the
  derived contribution is $622.87/mo and the page says FI is **not reached within 30 years**, while
  Edward's profile alone deducts ≈ $4,600/mo before net pay and 2026 vest income is ≈ $172k. The
  momentum chart on the same page crosses the target within a few years. Same blind spot in every
  "savings rate" on Overview/Spending.
- Taxes: 2026 runs on 2025's unindexed brackets in production (federal, state, Medicare, SS and CG
  tables identical); the primary's actual withholding cannot be entered. (The RSU-without-grants
  gap is latent only — production has grants and projects a refund with safe harbor met.)
- Two projection models on one page disagree wildly with no reconciliation.
- Credit-card economics: production has no category weights configured, so the page computes
  `$0.00` optimal rewards and declares five of six cards droppable; once weights are seeded, the
  many-to-one mapping double-counts Travel, Food, Shopping and Auto.
- Day change uses the wrong prior bar; no outlier guard; early-2023 net-pay artifacts wreck two
  Spending charts' axes.
- Credit-card "Optimal rewards" and "Net after fees" are inflated ~30% because many-to-one
  category mappings count Travel three times and Food, Shopping and Auto twice.
- "Taxes" and "Investments" spending categories are counted as spend in every savings rate and
  both sankeys; no fixed/discretionary/transfer kind exists.
Fix the derivations, share a "total savings" service, add reconciliation warnings and a bracket
staleness/index helper, split shared card weights, add a category kind, and draw both projection
models on a common basis.

### T3. Redesign the monthly ritual around honesty and review
_(Confirmed in production: the Sep 1 balances update left nineteen `$0.00` spending rows and no
net pay for September while August is still unentered.)_ Per-step save with explicit skip (never
write copied balances or implicit `$0.00` rows), a review-step anomaly panel (unchanged accounts,
outliers, sign flips, zero categories), component-sum reconciliation, save undo, retire guard,
blank-not-zero variable categories, fill/copy accelerators, recurring flags, coverage reminders,
and a repair action for already-written zero months. An append-only change log underpins undo,
activity, and import diffs.

### T4. One shell grammar
`PageFrame` for header/loading/error/stale; a shared scope store (owner · range · month) mirrored
to the URL with a single `ScopeBar`; one `Segmented` control; sliding session renewal with return-
to-page; a findable, keyword-aware palette with entity search; keyboard chords + `?` sheet; token
bridge enabling light theme and density; shell error boundary; targeted cache invalidation.

### T5. One chart grammar, then the specific visual fixes
`charts/grammar.ts` + a single tooltip contract + a house motion block + `echarts.connect` groups +
legend focus/scroll + export everywhere + required `ariaLabel`. Then: row-normalized heatmap,
zero-floored net-worth stack, projection arrival markers and log/fan fixes, price chart with cost
line and markers, treemap → heat-treemap, vesting today/future semantics.

### T6. New views the data already supports
"What moved" bar and MoM waterfall (net worth), employer-exposure tile, spending small multiples,
stacked income ladder and bracket headroom (taxes), sensitivity tornado and reach-date histogram
(projection), weekly cash-flow strip (calendar), share-of-assets/streamgraph mode, risk &
correlation from stored closes, dividend YoY, card economics over time.

### T7. Planning tools that don't require a database write
Paycheck sandbox with sliders and compare; tax what-if side-by-side, presets, pinning and
natural-language entry; projection scenario save/compare with URL state; contribution max-out
helper with YTD anchor; ESPP contribution optimizer; MFJ-vs-single comparison; price scenario strip
for equity.

### T8. Calendar as the forward engine
Money on events, recurrence for custom events, card fee/credit/anniversary events, contribution-cap
crossing dates, tax-deadline intelligence with the safe-harbor verdict, a subscription feed with
stable UIDs, source-health footer, agenda view, filters + URL state.

### T9. Assistant: grounding first, then agency
Expose every id a tool needs, move card math server-side, publish all page view state, stamp each
question with its context, verify figures against context, "ask about this chart", NL what-if that
pre-fills the sandbox, proposal tools with human confirmation, NL monthly-update drafts,
instrumentation and a working 429 path.

### T10. Two-earner completeness and empty-state gating
Per-person Comp/ESPP, a shared "scope is empty" card pointing at Settings, gate owner controls and
"Retires — Partner" on data presence, filing-status badges and a wedding divider, per-person
ticker.

### T11. Data lifecycle
Change log → Activity card and per-month history; import history with stored reports; restore from
the app's own export; undo for saves/deletes; backup verify; Settings information architecture
with a generic preferences endpoint.

### Post-fix ranking (2026-09-03, after the projection / card-setup / paycheck-seed fixes)

**Data actions the owner can take today, no code:** delete the phantom September 2026 spending
rows (`DELETE /api/v1/spending/months/2026-09-01`, balances untouched); enter the 2026 federal
bracket, SS wage base and capital-gains thresholds on the Taxes page (the stored 2026 tables are
2025's); enter the 2026 contribution limits in Settings so the pace strip works; map the 19 card
categories as described in the credit-card fix notes.

**Ranked product changes:**
1. Wizard decoupling + implicit-zero prevention + a repair action for zero-filled months (§4
   ideas 1–3). The phantom month recurs every balances-only save.
2. Coverage honesty (§3 idea 1, §0b): "entered" = at least one real value; flag the missing
   month, not the zero-filled one; two-tone ribbon; money-flow YTD basis; per-card "as of".
3. Savings definition unification: the projection now counts payroll savings while every
   savings-rate tile still uses net pay − spend (Overview YTD reads −2.2% beside a projection
   saving ≈ $5.6k/mo). One "total savings" service, cash and total shown side by side.
4. Category kind (fixed / discretionary / transfer): "Taxes" and "Investments" are counted as
   spend, inflating annual spend and therefore the FI target; excluding transfers moves the
   headline FI figures again.
5. Bracket staleness badge + index-by-percent helper + per-table verified toggle (§9 idea 2).
6. RSU vest stream in the projection: the remaining gap between the momentum chart and the model
   is ≈ $360k of scheduled vests through 2030; a dated vest stream (net of the 22%+10.23%+FICA
   withholding already in `withholding_calc`) closes it. Then reconcile the two charts (§5 ideas
   2–3) and add the sensitivity tornado.
7. Employer-exposure tile (NVDA holdings + ESPP lots + unvested RSUs as % of net worth) on
   Overview and Net worth — the household's largest single risk, computed nowhere.
8. Shell grammar (§2 ideas 1–8): PageFrame, shared owner/range/month scope in the URL, findable
   palette, session renewal, theme bridge.
9. Chart grammar + the specific visual fixes (§12 ideas 1–10).
10. Planning sandboxes (§8 idea 1, §9 ideas 5–6, §5 idea 5).
11. Calendar: one chip per vest date with its value, folded paydays, card fee/credit events,
    recurrence, subscription feed (§10 ideas 1–3, 8–9).
12. Assistant grounding (§11 ideas 1–6).
13. Two-earner empty-state gating (§5 idea 13).
14. Data lifecycle (§4 ideas 6–8).

### Quick wins (small, high-visibility)
Pay periods / percentages rendered as currency in the tax form · hero values clipping in narrow
windows · 36-chip Deactivate wall → one outage banner · Overview "Refresh" that doesn't refresh
prices · InfoHint clipping at right edges · 429 without `Retry-After` · band-legend quirk ·
Danger zone on the wizard's review step · TC chart's open-year cliff · lonely ESPP tile far from its
modeler · horizontally overflowing Comp/ESPP tables without a cue · "−100.0%" liability MoM · four
`$0.00` account rows · dead XIRR/Dividends columns · inert 1Y/3Y/Max chips · duplicate list card on
Calendar · four identical "enter this year's limit" links · five all-zero categories in the yearly
rollup · early-2023 net-pay outliers dominating two chart axes · "Net after fees" tile that exceeds
"Optimal rewards" because it silently adds credits · card and spending weights computed on months
ending Dec 2025 with no cue · "4% rule" label hard-coded over a configurable withdrawal rate ·
budget editor past-dating a first budget to the focused month · redundant Owner/Holder columns in
the card roster · **[prod]** Paycheck add-profile form pre-filled with the other person's profile ·
**[prod]** credit-card page declaring five cards droppable with no weights configured · **[prod]**
four separate "RSU vest" chips for one vest date · **[prod]** "Spending through Sep 2026" footer
over a zero-filled month. _(Local-only, dropped after the production pass: unlinked liability
accounts and understated total credit line.)_
