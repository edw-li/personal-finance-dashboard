# Lane G2 — Guide content: Tracking pages (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, one card per task, the fences as the
> test, then a spec-compliance review — voice, facts, coverage — and a code-quality review,
> then a local merge to main — never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane writes the
**Pages** chapter's Tracking cards (§5.1: Overview, Net worth, Portfolio, Spending, Credit cards)
under the writing rules in **§5.3**. Read §0, §4, §5 before Task 1. Source material:
`docs/superpowers/specs/2026-09-14-onboarding-guide-research.md` §5.3 P1–P5 and the file
pointers in its Appendix A.

**Goal:** five page cards — each with a one-sentence purpose, the page's views, 3–8 visible
tasks, the long tail behind *More*, and up to five traps — covering the owner's asks for
**adjusting portfolio holdings** and **adding and managing credit cards**, green under every fence.

**Architecture:** content only, in `src/guide/content/pages-tracking.tsx`. Lane G2 deletes its
five routes from `PENDING_PAGES`.

**Tech stack:** TypeScript 5.9 (`strict`), vitest 3 for the fences.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g2`, branch
  `guide/g2-tracking`, cut from `main` **after G0 has merged**. From the repo root:
  `git worktree add -b guide/g2-tracking .worktrees/guide-g2 main`, then work ONLY inside it.
- Commands run from the worktree root in Git Bash: `npx vitest run src/guide` (fences),
  `npx tsc -b`, `npx eslint src/guide`.
- Files this lane may edit: `src/guide/content/pages-tracking.tsx`, `src/guide/content/pending.ts`
  (delete `'/'`, `'/net-worth'`, `'/portfolio'`, `'/spending'`, `'/credit-cards'` only). Nothing else.
- Commit after every task. Never push.

## Writing rules this plan encodes (spec §5.3)

1. Verb first; steps ≤ 15 words where possible, never over 160 characters; 1–6 steps per task.
2. On-screen labels **bold and verbatim**; the fence requires the exact string to exist in
   `src/**/*.ts(x)` (non-test). Verify each against the Source lines:
   `grep -rnF -- "Label" src --include=*.tsx --include=*.ts | grep -v test`. Templated labels
   become angle-bracket placeholders (`**Open <TICKER>**`), which are exempt.
3. `where` uses ` → ` between places, ` · ` between alternatives; every segment must be a page
   name, a view label or UI text (fence). Generic locations start with "Any"/"Every"/"The".
4. `views` must equal the page's tab labels exactly (fence): Net worth `['Overview', 'Accounts']`;
   Portfolio `['Overview', 'Holdings', 'Allocation', 'Income', 'Manage']`; Spending
   `['Overview', 'Trends', 'Budgets', 'History']`; Credit cards `['Rewards', 'Credit lines', 'Manage']`;
   Overview has no strip — no `views` key.
5. One trap per *Watch out* line, rule plus consequence, em-dash clause. ≤ 5 per card.
6. Say what is not saved, not undoable, not per-person, not pre-filled.
7. No marketing words, no "simply", no numbers unless the number is the rule.
8. Never restate an `InfoHint` sentence — grep a five-word span of each step; rewrite verbatim hits.
9. Describe the current tabs; never "below"/"above" for content on another view.
10. No personal data. Pointer tasks link to the real destination, never to another lane's guide
    anchor (the link fence would fail until that lane lands).
11. Deep-link grammar available: `?section=<view>`, `?tab=transactions|securities|realized|dividends`
    (Portfolio arrival), `?ticker=`, `?drill=`, `?trend=`, `?card=`, `?month=`, `?owner=`, `?range=`.

## Draft copy

The literals below are **draft copy**: paste, verify every label and fact against the Source
lines, correct what the source contradicts, run the fences, then commit.

---

## Task 1 — Overview (spec §5.1 `page-overview`)

**Files:** Modify `src/guide/content/pages-tracking.tsx`.

**Source:** `src/pages/OverviewPage.tsx` — scope `:142-157, 361-369`; **Refresh** `:241-248, 638-640`;
**Customize** `src/components/overview/OverviewCustomize.tsx:28-40`; *Needs attention* `:739-754` +
`src/components/overview/attention.ts:55-262`; chart drills `:606-611, 671-676`; *Data status*
`src/components/overview/DataStatusCard.tsx:28-40`; *Up next* `:688-736`, `upNext.ts`; the quote-date
delta `:298-305`; "—" for take-home without spending `:332-334`; `Retry` banners `:655`.

- [ ] **Step 1: Write the card**

Replace the empty array in `src/guide/content/pages-tracking.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Pages — the Tracking group in sidebar order (2026-09-14 guide spec §5.1). Written by
// lane G2 from research §5.3 P1–P5; every bold label verified against source.
export const TRACKING_CARDS: GuideCard[] = [
  {
    id: 'page-overview',
    title: 'Overview',
    purpose:
      'A read-only briefing — four headline tiles, the year so far, the trend, what needs you and what is coming. Nothing here writes.',
    to: '/',
    keywords: ['overview', 'home', 'dashboard', 'briefing'],
    tasks: [
      {
        id: 'overview-whose',
        title: 'Switch whose figures you see',
        where: 'Overview → Whose',
        steps: [
          'Pick **All**, a person or **Joint** in the sticky row — the chips appear once two people exist.',
          'Net worth and holdings follow the choice; spending and portfolio performance stay household-wide and say so.',
        ],
        to: '/',
        keywords: ['owner', 'scope', 'partner', 'joint'],
      },
      {
        id: 'overview-customize',
        title: 'Choose which tiles and cards show',
        where: 'Overview → Customize',
        steps: [
          'Press **Customize** in the title row.',
          'Tick or untick tiles and cards; move them with the arrows.',
          'The layout is kept in this browser and follows your account at the next sign-in.',
        ],
        to: '/',
        watch: ['The last remaining tile cannot be removed.'],
        keywords: ['layout', 'hide tile', 'reorder'],
      },
      {
        id: 'overview-attention',
        title: 'Act on Needs attention',
        where: 'Overview → Needs attention',
        steps: [
          'Each line is a condition the data proves — an overdue update, missing spending, a stale quote, a failed ticker, a stale backup, a missing tax year.',
          'Click the line to land where it is fixed.',
          'The card is absent when nothing is wrong.',
        ],
        to: '/',
        keywords: ['attention', 'overdue', 'todo'],
      },
      {
        id: 'overview-refresh',
        title: 'Refresh the page',
        where: 'Overview → Refresh',
        steps: [
          'Press **Refresh** in the title row to re-run every feed.',
          'A single failed feed shows a banner with **Retry** and leaves the others on screen.',
        ],
        to: '/',
      },
    ],
    more: [
      {
        id: 'overview-drill',
        title: 'Jump from a chart into its page',
        where: 'Overview → Net worth trend · Recent spending',
        steps: [
          'Click a point on the trend and press **Open net worth records** for that month\u2019s accounts.',
          'Click a spending bar and press **Open spending** to focus that month.',
        ],
        to: '/',
      },
      {
        id: 'overview-data-status',
        title: 'Read how fresh the data is',
        where: 'Overview → Data status',
        steps: [
          '**Prices as of** names the oldest quote; balances, spending and take-home each say the month they run through.',
          'A feed a month or more behind the others turns amber.',
        ],
        to: '/',
        keywords: ['freshness', 'stale', 'as of'],
      },
      {
        id: 'overview-up-next',
        title: 'See what is coming',
        where: 'Overview → Up next',
        steps: [
          'Deadlines due within two weeks come first, then at most one payday — five rows in all.',
          'The line underneath sums what the next 45 days move in and out; the calendar link shows the rest.',
        ],
        to: '/calendar',
        keywords: ['upcoming', 'events', 'deadlines'],
      },
    ],
    watch: [
      'The portfolio delta is dated from the newest quote — it names that day, not "today", unless the quote is today\u2019s.',
      'A month with take-home but no spending shows "—", not $0.',
      'Spending and portfolio performance have no owner dimension — they stay household-wide under any Whose chip.',
    ],
  },
]
```

- [ ] **Step 2: Verify labels and facts** — `Customize`, `Refresh`, `Retry`, `All`, `Joint`,
`Open net worth records`, `Open spending`, `Prices as of`, `Needs attention`, `Up next`,
`Data status` against the Source lines; the two-week / one-payday / five-row ranking in `upNext.ts`;
`UP_NEXT_WINDOW_DAYS` = 45.

- [ ] **Step 3: Fences** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`.
Expected: the "pending route has no card" test FAILS for `/` until you delete `'/'` from
`PENDING_PAGES` — do it in this task.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-tracking.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Overview (spec §5.1)"
```

---

## Task 2 — Net worth (spec §5.1 `page-net-worth`)

**Source:** `src/pages/NetWorthPage.tsx` — **Enter month** `:598-602`; views `:553-556, 667`;
**Monthly**/**Quarterly** `:83-88, 249-257, 364-370, 494-501`; owner scope `:226-247, 520-531, 654-662`;
window chips `:196-221`; ribbon month `:422-448`; tiles `:667-715`; **Stack by** `:720-773`; *What
moved* `:775-803`; drill-down `:54, 474-492, 822-862, 880-921`; `?drill=` `:176-191`;
`src/components/ChartExportMenu.tsx:113-137`; `backend/app/services/value_history.py:1-26, 252-302`
(Monday-only point); `backend/app/importer/apply.py:351-397` (re-import overrides).

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-net-worth',
    title: 'Net worth',
    purpose:
      'Every account\u2019s balance over time and the month-to-month story — read and analyse here; accounts are defined in Settings and balances entered in the monthly update.',
    to: '/net-worth',
    views: ['Overview', 'Accounts'],
    keywords: ['net worth', 'accounts', 'balances', 'assets', 'liabilities'],
    tasks: [
      {
        id: 'networth-accounts-pointer',
        title: 'Add or change an account',
        where: 'Settings → Household → Accounts',
        steps: [
          'Accounts are added, owned, retired and linked as parent and component in Settings → Household → **Accounts** — see the Settings card in this guide.',
        ],
        to: '/settings?section=household#accounts',
        keywords: ['add account', 'new account'],
      },
      {
        id: 'networth-grain',
        title: 'Read monthly or quarterly',
        where: 'Net worth → Overview',
        steps: [
          'Press **Monthly** or **Quarterly** in the strip.',
          'Under Quarterly, a ribbon pick snaps to the last quarter end at or before it.',
        ],
        to: '/net-worth',
        keywords: ['quarterly', 'grain'],
      },
      {
        id: 'networth-past-month',
        title: 'Look at a past month\u2019s balances',
        where: 'Net worth → Accounts',
        steps: [
          'Click a month chip in the ribbon — the table swaps to that month and the tiles follow.',
          'The card heading names the month it shows; chips print that month\u2019s net worth.',
        ],
        to: '/net-worth?section=accounts',
        keywords: ['history', 'past month', 'balances table'],
      },
      {
        id: 'networth-stack-by',
        title: 'Change how the chart stacks',
        where: 'Net worth → Overview → By group over time',
        steps: [
          'Pick **Group**, **Owner** or **Share %** under **Stack by**.',
          '**Share %** shows composition and drops the net-worth line; Owner is hidden for a one-person household.',
        ],
        to: '/net-worth',
        keywords: ['stacked chart', 'composition', 'by owner'],
      },
      {
        id: 'networth-what-moved',
        title: 'See what moved this month',
        where: 'Net worth → Overview → What moved',
        steps: [
          'Pick **Group** or **Account** under **Break down by**.',
          'The list is the movement between the viewed month and the one before — shown, not judged.',
        ],
        to: '/net-worth',
        keywords: ['movers', 'change', 'attribution'],
      },
      {
        id: 'networth-drilldown',
        title: 'Compare accounts over time',
        where: 'Net worth → Accounts → Account drill-down',
        steps: [
          'Click rows in the accounts table, or the chips in the chart\u2019s footer — up to eight accounts.',
          'Removing one never recolours the others; a ninth chip is disabled rather than refused silently.',
        ],
        to: '/net-worth?section=accounts',
        keywords: ['compare accounts', 'drill'],
      },
      {
        id: 'networth-export',
        title: 'Export a chart',
        where: 'Any chart → Export',
        steps: [
          'Press **Export** and choose **PNG**, **Copy image** or **CSV**.',
          '**Table** shows the same data as a table under the chart.',
        ],
        to: '/net-worth',
        keywords: ['export', 'csv', 'png', 'download chart'],
      },
    ],
    more: [
      {
        id: 'networth-window',
        title: 'Set the time window',
        where: 'Net worth → All · 1Y · YTD',
        steps: [
          'Pick **All**, **1Y** or **YTD** in the sticky row — both charts share one axis.',
          'Ctrl + wheel zooms a chart; the next chip snaps the zoom away.',
        ],
        to: '/net-worth',
      },
      {
        id: 'networth-owner-scope',
        title: 'Scope to one person',
        where: 'Net worth → Whose',
        steps: [
          'Pick a person or **Joint** — tiles, charts and the table follow.',
          'A scope that owns nothing shows one sentence and a link to Settings → Accounts instead of zeros.',
        ],
        to: '/net-worth',
      },
      {
        id: 'networth-weekly-point',
        title: 'Understand the weekly performance point',
        where: 'Net worth · Portfolio',
        steps: [
          'The performance history records one point per week, after Monday\u2019s close, in the product time zone.',
          'A refresh on another weekday keeps quotes fresh and backfills any Monday the server slept through.',
          'Re-importing the workbook overwrites Monday rows up to the sheet\u2019s last date; later rows survive.',
        ],
      },
    ],
    watch: [
      'Liabilities are stored as negative numbers — net worth is the plain sum of every non-component balance.',
      'A flat month reads neutral, not green.',
      'The weekly performance point is Monday-only — keep the refresh schedule covering Mondays.',
    ],
  },
```

- [ ] **Step 2: Verify** — `Monthly`, `Quarterly`, `Stack by`, `Group`, `Owner`, `Share %`,
`Break down by`, `Account`, `Export`, `PNG`, `Copy image`, `CSV`, `Table`, `All`, `1Y`, `YTD`,
`Joint`; the card titles `By group over time`, `What moved`, `Account drill-down` (used as where
segments) exist in `NetWorthPage.tsx`; the eight-account cap (`:54`); Monday-only (`value_history.py:48-55`).

- [ ] **Step 3: Fences** (delete `'/net-worth'` from `PENDING_PAGES`) — `npx vitest run src/guide && npx tsc -b`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-tracking.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Net worth (spec §5.1)"
```

---

## Task 3 — Portfolio (spec §5.1 `page-portfolio`)

**Source:** `src/pages/PortfolioPage.tsx` — **Refresh prices** and status line `:394-399, 500-534`;
failure chip **Deactivate** `:423-435, 545-564`; `?tab=` arrivals `:127, 175-200`; holding detail
`:220-226, 483-492, 709-756`; performance and benchmarks `:441-479, 669-707`; owner scope `:567-576,
689-696`; `src/components/portfolio/SecuritiesPanel.tsx:161-330` (**Save price** `:305-327`),
`TransactionsPanel.tsx:75, 314-430, 482-500` (form, **Duplicate**, kept fields),
`DividendsPanel.tsx:229-231, 287-410`, `ClassificationEditor.tsx:71-220` (**Show all securities**),
`AllocationTargetEditor.tsx:27-133` (**Edit**, **Save draft**, **Activate targets**, **Add category**,
100 % rule), `AllocationPanel.tsx:105-134` (**Allocation dimension**, `Open <TICKER>`),
`src/components/portfolio/HoldingsTable.tsx:80`; `README.md:596-700` (import-first).

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-portfolio',
    title: 'Portfolio',
    purpose:
      'Holdings, prices, performance, allocation and income for the household\u2019s investment accounts — with the ledgers that feed them under Manage.',
    to: '/portfolio',
    views: ['Overview', 'Holdings', 'Allocation', 'Income', 'Manage'],
    keywords: ['portfolio', 'holdings', 'stocks', 'shares', 'prices', 'dividends'],
    tasks: [
      {
        id: 'portfolio-refresh',
        title: 'Refresh prices',
        where: 'Portfolio → Refresh prices',
        steps: [
          'Press **Refresh prices** in the title row (or **Refresh now** under Settings → Integrations → Price refresh).',
          'The status line reads prices as of, last refresh, updated and failed counts, and the next scheduled run.',
          'On a Monday this also records the weekly performance point.',
        ],
        to: '/portfolio',
        watch: ['"Prices as of" is the oldest quote across holdings — the staleness clock, not the newest.'],
        keywords: ['quotes', 'update prices', 'stale prices'],
      },
      {
        id: 'portfolio-transaction',
        title: 'Record a buy, sell or split',
        where: 'Portfolio → Manage → Transactions',
        steps: [
          'Pick the **Security** and type the **Account** label — one from the list, or a new one.',
          'Pick the **Type** (buy, sell or split) and the **Date**, then shares, price and fees.',
          'Press **Add** — the form keeps security, account, type and date and clears the amounts for the next row.',
          'Use **Duplicate** on a row to seed a repeat.',
        ],
        to: '/portfolio?section=manage&tab=transactions',
        watch: [
          'A new account label creates a portfolio account owned by the primary person — re-tag it under Settings → Household → Accounts.',
          'Performance math (XIRR) needs dated transactions — imported rows have none until you add dates.',
        ],
        keywords: ['buy', 'sell', 'split', 'transaction', 'holdings', 'adjust holdings', 'shares'],
      },
      {
        id: 'portfolio-security',
        title: 'Add or edit a security',
        where: 'Portfolio → Manage → Securities',
        steps: [
          'Fill the ticker, name, industry, holding type, whether it is manual-priced, and its dividend details.',
          'Press **Add**; per row, **Edit** or **Delete**.',
          'Delete is refused while any transaction or dividend references the security — deactivate it instead.',
        ],
        to: '/portfolio?section=manage&tab=securities',
        keywords: ['ticker', 'new security', 'fund'],
      },
      {
        id: 'portfolio-manual-price',
        title: 'Set a price by hand',
        where: 'Portfolio → Manage → Securities',
        steps: [
          'On a manual-priced security, type the price and press **Save price**.',
          'Use this for private or NAV-priced assets the price feed cannot see.',
        ],
        to: '/portfolio?section=manage&tab=securities',
        keywords: ['manual price', 'private asset', 'nav'],
      },
      {
        id: 'portfolio-dividend',
        title: 'Log a dividend',
        where: 'Portfolio → Income → Dividends',
        steps: [
          'Pick the security and account, the pay date and the amount, then **Save**.',
          'Refreshes write automatic rows from real ex-dividend events; manual rows cover manual-priced holdings and older history.',
        ],
        to: '/portfolio?section=income&tab=dividends',
        watch: ['Automatic records carry the ex-date, not the pay date.'],
        keywords: ['dividend', 'income', 'payment'],
      },
      {
        id: 'portfolio-holding-detail',
        title: 'Inspect one holding',
        where: 'Portfolio → Holdings',
        steps: [
          'Click a row — the detail panel opens with its history and income.',
          '**Clear selection** closes it; switching owner closes it too.',
        ],
        to: '/portfolio?section=holdings',
        keywords: ['holding detail', 'position'],
      },
      {
        id: 'portfolio-classify',
        title: 'Classify securities for allocation',
        where: 'Portfolio → Allocation → Security classifications',
        steps: [
          'Set each security\u2019s asset class, geography and industry; add a note if useful.',
          'Use the search box to find one; **Show all securities** lifts the filter.',
          'Classifications feed the allocation dimensions and the heat treemap.',
        ],
        to: '/portfolio?section=allocation',
        keywords: ['asset class', 'geography', 'industry', 'classification'],
      },
      {
        id: 'portfolio-targets',
        title: 'Set allocation targets',
        where: 'Portfolio → Allocation → Your allocation targets',
        steps: [
          'Press **Edit**; type a target percent and a tolerance for each category; **Add category** for a new one.',
          'Press **Save draft** to keep working, or **Activate targets** once the targets sum to exactly 100 %.',
        ],
        to: '/portfolio?section=allocation',
        keywords: ['targets', 'drift', 'rebalance'],
      },
    ],
    more: [
      {
        id: 'portfolio-deactivate',
        title: 'Retire a ticker that keeps failing',
        where: 'Portfolio → failure chip',
        steps: [
          'A ticker the price feed cannot resolve shows a red chip under the title.',
          'Press **Deactivate** — it leaves every future refresh and the Overview\u2019s attention list.',
          'Bring it back from Manage → Securities.',
        ],
        to: '/portfolio',
        keywords: ['delisted', 'failed ticker'],
      },
      {
        id: 'portfolio-benchmarks',
        title: 'Read the performance benchmarks',
        where: 'Portfolio → Overview → Performance',
        steps: [
          'The value line is checkpointed weekly after Monday\u2019s close; the pinging dot is the live value at the latest prices.',
          'The S&P 500 baseline invests only the starting balance; the VOO leg invests every inferred contribution.',
          'The live dot renders only on the All scope — the history is household-wide.',
        ],
        to: '/portfolio',
        keywords: ['benchmark', 'performance', 'voo'],
      },
      {
        id: 'portfolio-dimension',
        title: 'Switch the allocation dimension',
        where: 'Portfolio → Allocation → Allocation dimension',
        steps: [
          'Pick a dimension; a slice\u2019s member list has **Open** links that jump to Holdings with that ticker drilled.',
        ],
        to: '/portfolio?section=allocation',
      },
      {
        id: 'portfolio-owner',
        title: 'Scope the portfolio to a person',
        where: 'Portfolio → Whose',
        steps: [
          'Holdings, allocation, dividends, transactions and realized gains follow the person — their accounts plus the joint ones.',
          'Performance, sparklines and price refresh stay household-wide by design.',
        ],
        to: '/portfolio',
      },
      {
        id: 'portfolio-import-order',
        title: 'Import first, then edit',
        where: 'Settings → Data → Import workbook',
        steps: [
          'The workbook importer loads history; re-applying it overwrites sheet-covered rows.',
          'Edit in the UI only after the last import you intend to run.',
        ],
        to: '/settings?section=data#import',
      },
    ],
    watch: [
      'The two benchmark legs mean different things — read their names before comparing them.',
      'A holding\u2019s industry comes from its classification, not the price feed.',
      'Deleting a security is refused while it is referenced — deactivate instead.',
    ],
  },
```

- [ ] **Step 2: Verify** — `Refresh prices`, `Refresh now`, `Security`, `Account`, `Type`, `Date`,
`Add`, `Duplicate`, `Edit`, `Delete`, `Save price`, `Save`, `Clear selection`, `Show all securities`,
`Save draft`, `Activate targets`, `Add category`, `Deactivate`, `Open`; where segments
`Transactions`, `Securities`, `Dividends`, `Security classifications`, `Your allocation targets`,
`Allocation dimension`, `Performance` exist as card titles; the 100 % rule (`AllocationTargetEditor.tsx`,
`totalUnits !== 1_000_000`); `?tab=dividends` lands on Income (`PortfolioPage.tsx:127`).

- [ ] **Step 3: Fences** (delete `'/portfolio'` from `PENDING_PAGES`).

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-tracking.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Portfolio (spec §5.1)"
```

---

## Task 4 — Spending (spec §5.1 `page-spending`)

**Source:** `src/pages/SpendingPage.tsx` — **Enter month** `:469-487`; drill `:135-139, 302-330,
561-602`; tiles `:311-313, 428-446, 513-546`; **Month**/**Year** flow `:322-329, 642-676`; trends
`:412-421, 727-792`; heatmap `:799-853`; rollups `:857-969`; movers `:63-72, 605-640`;
`src/components/spending/BudgetPanel.tsx` — seed `:120-175`, re-seed `:345-382`, editor
`:96-101, 177-211, 251-276`, end a budget `:177-190`, chips `:277-284`, history `:66-68, 213-228`;
`backend/app/services/budgets.py:22-43, 47-161`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-spending',
    title: 'Spending',
    purpose:
      'Where the money went by month and category, the savings rates, and category budgets — the entries themselves come from the monthly update.',
    to: '/spending',
    views: ['Overview', 'Trends', 'Budgets', 'History'],
    keywords: ['spending', 'budget', 'categories', 'savings rate', 'expenses'],
    tasks: [
      {
        id: 'spending-enter-pointer',
        title: 'Enter a month\u2019s spending',
        where: 'Monthly update → Spending',
        steps: [
          'Spending is entered in the monthly update — **Enter month** in the title row opens it on the spending step; the full routine is in this guide\u2019s Routines chapter.',
        ],
        to: '/update?step=spending',
        keywords: ['enter spending', 'record spending'],
      },
      {
        id: 'spending-drill-month',
        title: 'Focus one month',
        where: 'Spending → Overview',
        steps: [
          'Click a bar in the monthly chart, or a chip in the ribbon.',
          'The tiles, **What changed**, the flow and the budgets follow that month; **All months** clears it.',
        ],
        to: '/spending',
        keywords: ['month detail', 'drill month'],
      },
      {
        id: 'spending-flow-window',
        title: 'See where the period went',
        where: 'Spending → Overview → Where the period went',
        steps: [
          'Pick **Month** or **Year**.',
          'With no take-home for the period the card asks for it instead of drawing an empty flow.',
        ],
        to: '/spending',
        keywords: ['sankey', 'flow', 'where money went'],
      },
      {
        id: 'spending-trends',
        title: 'Compare categories over time',
        where: 'Spending → Trends → Category trends',
        steps: [
          'Pick up to three category chips — a picked category\u2019s budget rides along as a dashed line.',
          '**All categories** shows small multiples, each on its own scale.',
        ],
        to: '/spending?section=trends',
        keywords: ['trend', 'category over time'],
      },
      {
        id: 'spending-heatmap',
        title: 'Read the month × category heatmap',
        where: 'Spending → History',
        steps: [
          'Pick **Row**, **vs average** or **Absolute** for the colour scale.',
          'Categories that never spent stay hidden until you show the dormant rows.',
        ],
        to: '/spending?section=history',
        keywords: ['heatmap', 'history'],
      },
      {
        id: 'spending-budget-seed',
        title: 'Seed budgets from your averages',
        where: 'Spending → Budgets',
        steps: [
          'Press **Start from my averages** — it needs three complete months; a disabled button says how many you have.',
          'One dated budget per living category is written from the focused month; the toast offers **Undo**.',
          'Later, **Re-seed from averages** asks you to confirm before rewriting.',
        ],
        to: '/spending?section=budgets',
        keywords: ['budget seed', 'averages', 'default budgets'],
      },
      {
        id: 'spending-budget-set',
        title: 'Set or change one budget',
        where: 'Spending → Budgets → a category row',
        steps: [
          'Press **Set budget** or **Edit budget**.',
          'Type the **Monthly budget**; pick **Effective from** — it defaults to the focused month, the month the meters read.',
          'Press **Save**.',
        ],
        to: '/spending?section=budgets',
        watch: ['Budgets are effective-dated — dating one in the past rewrites what that era\u2019s budget was.'],
        keywords: ['set budget', 'edit budget', 'monthly budget'],
      },
      {
        id: 'spending-budget-end',
        title: 'End a budget',
        where: 'Spending → Budgets → a category row',
        steps: ['Open the editor, blank the **Monthly budget** box and press **Save** — the budget ends from that month on.'],
        to: '/spending?section=budgets',
        keywords: ['remove budget', 'stop budget'],
      },
    ],
    more: [
      {
        id: 'spending-yearly',
        title: 'Read the yearly rollups',
        where: 'Spending → History → Yearly rollups',
        steps: [
          'Living spend, tax paid, transfers and both savings rates cover only months with spending and take-home — the matched row counts them.',
        ],
        to: '/spending?section=history',
      },
      {
        id: 'spending-movers',
        title: 'Read What changed',
        where: 'Spending → Overview → What changed',
        steps: [
          'The five biggest category moves against the prior month and the twelve-month average — and against budget when one exists.',
          'Spending up is red — the arrow says which way, the colour whether that is good.',
        ],
        to: '/spending',
      },
      {
        id: 'spending-export',
        title: 'Export a chart',
        where: 'Any chart → Export',
        steps: ['Press **Export** and choose **PNG**, **Copy image** or **CSV**; **Table** shows the data.'],
        to: '/spending',
      },
    ],
    watch: [
      'Living spending excludes categories of kind Tax and Transfer — set kinds under Settings → Household → Spending categories.',
      'The previous-12-months comparison counts only eligible months — a month nobody entered reduces the count, not the average.',
      'Spending is never pre-filled from last month; balances are.',
    ],
  },
```

- [ ] **Step 2: Verify** — `Enter month`, `All months`, `Month`, `Year`, `All categories`, `Row`,
`vs average`, `Absolute`, `Start from my averages`, `Re-seed from averages`, `Set budget`,
`Edit budget`, `Monthly budget`, `Effective from`, `Save`, `Undo`, `What changed`; where segments
`Where the period went`, `Category trends`, `Yearly rollups` exist as card titles (grep
`SpendingPage.tsx`); `MIN_SEED_MONTHS = 3`; the **Effective from** default is the focused month
(`BudgetPanel.tsx:96-101`).

- [ ] **Step 3: Fences** (delete `'/spending'` from `PENDING_PAGES`).

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-tracking.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Spending (spec §5.1)"
```

---

## Task 5 — Credit cards (spec §5.1 `page-credit-cards`)

**Source:** `src/pages/CreditCardsPage.tsx` — views `:67`; **+ Add card** `:330-335`; drill `:112-124,
177-197, 250-254`; scope `:182-248, 337-345, 405-421`; tiles and the no-weights rule `:213-221,
378-482`; `src/components/creditcards/CardsPanel.tsx:45-171, 314-416` (form; undated nudge `:296-298,
519-527`; **Edit**/**Save card** `:99-200`; **Archive**/**Unarchive** `:202-228`; **Delete** + Undo
`:230-293`); `CategoriesPanel.tsx:20-35, 245-256` (seed), `:117-161, 258-288` (form), `:163-172`
(**Hide**/**Show**), `:209-243, 440-461` (reorder); `RewardsMatrix.tsx:105-161, 333-387` (**Edit
multipliers**, inspector, **Save multipliers**), `:182-194, 389-393` (**Multiplier**/**Effective %**);
`CardDetail.tsx:111-138` (**Add credit**), `:158-174, 319-333` (cadence toggle), `:140-156`
(**Counts**/**Ignored**), `:206-229, 445-476` (limit **Add**), `:79-98, 251-254, 478-495` (utilization);
`backend/app/services/calendar/generators/cards.py:36-106`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-credit-cards',
    title: 'Credit cards',
    purpose:
      'Which card to use for what, what each card is worth after its fee, and the household\u2019s credit lines — from a roster you keep under Manage.',
    to: '/credit-cards',
    views: ['Rewards', 'Credit lines', 'Manage'],
    keywords: ['credit card', 'cards', 'rewards', 'points', 'annual fee', 'credit line'],
    tasks: [
      {
        id: 'cards-add',
        title: 'Add a card',
        where: 'Credit cards → Manage → Card roster',
        steps: [
          'Press **Add card** in the title row — Manage opens with the name box focused.',
          'Fill **Card name**, **Annual fee**, **Rewards currency** and **Point value** (cents per point; 1 for cash).',
          'Pick the **Owner**, add **Authorized users**, set **Opened** and the **Linked liability account**.',
          'Press **Add card**.',
        ],
        to: '/credit-cards?section=manage',
        keywords: ['new card', 'open a card', 'add credit card'],
      },
      {
        id: 'cards-opened-date',
        title: 'Set the opened date',
        where: 'Credit cards → Manage → Card roster → Opened',
        steps: [
          'Type the date the card was opened.',
          'It dates the anniversary, the annual fee and any anniversary-cadence credit on the calendar; year two is badged as falling off 5/24.',
        ],
        to: '/credit-cards?section=manage',
        watch: ['No opened date means no fee, anniversary or anniversary-cadence credit event at all — the roster names every undated card.'],
        keywords: ['anniversary', 'opened', '5/24'],
      },
      {
        id: 'cards-owner',
        title: 'Choose who holds a card',
        where: 'Credit cards → Manage → Card roster → Owner',
        steps: [
          'Pick a person, or leave **Owner** blank for a joint card either of you can hold.',
          'A person\u2019s view on Rewards and Credit lines shows their cards plus the joint ones; Manage always lists every card.',
        ],
        to: '/credit-cards?section=manage',
        keywords: ['joint card', 'ownership', 'whose card'],
      },
      {
        id: 'cards-category-add',
        title: 'Add a reward category',
        where: 'Credit cards → Manage → Categories & weights',
        steps: [
          'Type the **Category name**; map it to a **Spending category** so its yearly weight comes from real spend, or type an **Annual spend override**.',
          'Optionally **Pin to card**.',
          'Press **Add category**; drag the grip, or focus it and press ↑/↓, to reorder.',
        ],
        to: '/credit-cards?section=manage',
        watch: ['A row with neither a mapping nor an override is left out of every dollar figure.'],
        keywords: ['reward category', 'weight'],
      },
      {
        id: 'cards-multipliers',
        title: 'Fill in the rewards matrix',
        where: 'Credit cards → Rewards → Rewards matrix',
        steps: [
          'Press **Edit multipliers**.',
          'Click a cell; type the **Multiplier**, an optional **Condition note** and **Monthly bonus cap**; **Clear cell** makes the card unusable for that category.',
          'Press **Save multipliers** — one save writes every changed cell.',
          'Switch **Multiplier** / **Effective %** to change the number you read; the winner never changes.',
        ],
        to: '/credit-cards',
        keywords: ['multiplier', 'matrix', 'best card', 'points per dollar'],
      },
      {
        id: 'cards-detail',
        title: 'Open a card\u2019s detail',
        where: 'Credit cards → Rewards → a card\u2019s column header',
        steps: [
          'Click the card\u2019s column header.',
          'Read its recurring credits, credit line and utilization; **Back to matrix** returns.',
        ],
        to: '/credit-cards',
        keywords: ['card detail'],
      },
      {
        id: 'cards-credit-add',
        title: 'Track a recurring credit or benefit',
        where: 'Card detail → Recurring credits',
        steps: [
          'Type the credit\u2019s label and its yearly value; press **Add credit**.',
          'Toggle **Resets Jan 1** / **Resets on anniversary** and **Counts** / **Ignored** per credit.',
          'Counted credits enter the card\u2019s net-after-fee figure and appear on the calendar when they reset.',
        ],
        to: '/credit-cards',
        keywords: ['credit', 'benefit', 'statement credit', 'perk'],
      },
      {
        id: 'cards-limit-add',
        title: 'Record a credit-limit change',
        where: 'Card detail → Credit line',
        steps: [
          'Type the effective date, the new limit and a note; press **Add**.',
          'The latest event by date is the card\u2019s current limit — it drives the total credit line and utilization.',
        ],
        to: '/credit-cards?section=lines',
        watch: ['One event per card per date — delete the old one first.'],
        keywords: ['credit limit', 'limit increase'],
      },
    ],
    more: [
      {
        id: 'cards-categories-seed',
        title: 'Start with the spreadsheet\u2019s categories',
        where: 'Credit cards → Manage → Categories & weights',
        steps: ["While the list is empty, press **Start with the spreadsheet's categories** — fourteen rows appear in order."],
        to: '/credit-cards?section=manage',
      },
      {
        id: 'cards-archive-delete',
        title: 'Archive or delete a card',
        where: 'Credit cards → Manage → Card roster',
        steps: [
          '**Archive** keeps history and removes the card from the matrix, tiles and chart; **Unarchive** brings it back.',
          '**Delete** removes it; the toast\u2019s **Undo** restores the card, its credits and limit events — matrix multipliers are not restored.',
        ],
        to: '/credit-cards?section=manage',
        keywords: ['close card', 'archive card', 'delete card'],
      },
      {
        id: 'cards-utilization',
        title: 'Read utilization',
        where: 'Card detail → Utilization',
        steps: [
          'Needs a linked liability account with a balance in the latest snapshot and a current limit.',
          'Shown as balance ÷ limit; balances are stored negative and the sign is handled for you.',
        ],
        to: '/credit-cards',
      },
      {
        id: 'cards-hide-category',
        title: 'Hide or reorder a category',
        where: 'Credit cards → Manage → Categories & weights',
        steps: [
          '**Hide** removes a row from the matrix without losing its cells; **Show** brings it back.',
          'Drag the grip, or focus it and press ↑/↓, to reorder.',
        ],
        to: '/credit-cards?section=manage',
      },
    ],
    watch: [
      'The tiles read "—" until at least one category has a weight — a matrix with no weights would call every card droppable.',
      'A blank multiplier means the card cannot be used for that category; it is not zero.',
      'Deleting a card can be undone, but its matrix multipliers are not restored.',
    ],
  },
]
```

- [ ] **Step 2: Verify** — every bold label above against `CardsPanel.tsx`, `CategoriesPanel.tsx`,
`RewardsMatrix.tsx`, `CardDetail.tsx` (in particular `Point value`, `Authorized users`,
`Linked liability account`, `Condition note`, `Monthly bonus cap`, `Clear cell`, `Back to matrix`,
`Resets Jan 1`, `Resets on anniversary`, `Counts`, `Ignored`); where segments `Card roster`,
`Categories & weights`, `Rewards matrix`, `Recurring credits`, `Credit line`, `Utilization` are card
titles; the straight apostrophe in `Start with the spreadsheet's categories` matches the source.

- [ ] **Step 3: Fences** (delete `'/credit-cards'` from `PENDING_PAGES`).

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-tracking.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Credit cards (spec §5.1)"
```

---

## Task 6 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
Expected: green; `PENDING_PAGES` no longer lists this lane's five routes.

- [ ] **Step 2: Results** — append `## Results (implementer, <date>)` with commits, gate counts,
every label changed from the draft and why, deviations, hand-offs (renderer requests go to V).

## Self-review (done while writing)

- Spec §5.1 required ids: Overview 4 ✓; Net worth 7 incl. `networth-accounts-pointer` ✓; Portfolio
  9 (8 visible + `portfolio-deactivate` folded) ✓; Spending 8 incl. `spending-enter-pointer` ✓;
  Credit cards 10 (8 visible + `cards-categories-seed`, `cards-archive-delete` folded) ✓.
- Required-coverage ids owned here: `portfolio-transaction`, `portfolio-security`,
  `portfolio-classify`, `cards-add`, `cards-multipliers`, `cards-credit-add`, `cards-owner` ✓.
- Fences: `views` match each page's strip; visible tasks 4/7/8/8/8 (3–8 ✓); `watch` ≤ 5; pointer
  tasks link to real destinations with one step ✓; query keys `section`, `tab`, `step` ✓.

---

## Results (implementer, 2026-09-14)

Status: **DONE**. All five Tracking cards written into `src/guide/content/pages-tracking.tsx`; the
lane's five routes deleted from `PENDING_PAGES`; every fence, the full frontend suite and the build
green. Nothing outside the two permitted files was touched.

### Commits (branch `guide/g2-tracking`, cut from `e0d289c`)

| Commit | Task |
| --- | --- |
| `dca6721` | content(guide): Pages — Overview (spec §5.1) |
| `f218d90` | content(guide): Pages — Net worth (spec §5.1) |
| `ff2dbb0` | content(guide): Pages — Portfolio (spec §5.1) |
| `daf9710` | content(guide): Pages — Spending (spec §5.1) |
| `6a528b2` | content(guide): Pages — Credit cards (spec §5.1) |
| `8b4f626` | content(guide): Pages — Tracking voice pass (no InfoHint echoes, purpose and step length) |

The sixth commit is the §5.3 self-review pass described under *Voice pass* below; it is content-only
and touches the same one file.

### Gates

- Per-card, after every task: `npx vitest run src/guide` → **5 files, 23 passed, 1 skipped** (the
  required-coverage assertion stays skipped while `PENDING_PAGES` is non-empty — G1/G3/G4 routes remain).
  `npx tsc -b` clean, `npx eslint src/guide` clean.
- Final full gates: `npx tsc -b` clean · `npx eslint .` **0 errors, 25 warnings** (all pre-existing
  `react-refresh/only-export-components`, none in `src/guide`) · `npx vitest run` **231 files,
  3093 passed, 1 skipped** · `npm run build` ✓ (12.17 s).
- `PENDING_PAGES` now: `/update`, `/paycheck`, `/comp`, `/espp`, `/taxes`, `/projection`, `/calendar`,
  `/settings` — this lane's five are gone and the "pending route has no card" fence passes.

### Shape

| Card | `views` | Visible tasks | More | Card watch |
| --- | --- | --- | --- | --- |
| `page-overview` | none (no tab strip) | 4 | 3 | 3 |
| `page-net-worth` | Overview · Accounts | 7 | 3 | 3 |
| `page-portfolio` | Overview · Holdings · Allocation · Income · Manage | 8 | 5 | 4 |
| `page-spending` | Overview · Trends · Budgets · History | 8 | 3 | 4 |
| `page-credit-cards` | Rewards · Credit lines · Manage | 8 | 4 | 4 |

Every spec §5.1 required id is present; `portfolio-deactivate`, `cards-categories-seed` and
`cards-archive-delete` sit under *More* as the plan allowed. Every `to` on a page card is the bare
route (lane G0's finding); query keys used are `section`, `tab`, `step` only.

### Labels and facts changed from the plan's draft copy

Each was verified with `grep -rnF -- "<label>" src --include=*.tsx --include=*.ts | grep -v test`
against the Source lines the plan lists; the draft is wrong wherever this table says so.

**Overview**

1. `overview-customize` — the popover is not "tiles and cards … move them with the arrows": the real
   labels are the **Summary tiles** and **Deeper views** fieldsets, per-item ↑/↓ buttons,
   **Reset to defaults** and **Done** (`OverviewCustomize.tsx:29-46`). Step rewritten around them.
2. `overview-customize` — draft: layout "kept in this browser and follows your account at the next
   sign-in". `setLocal` writes storage *and* debounce-PATCHes the pref to the server
   (`prefsStore.ts:212-229`), so the step now says it saves to your account, not to this browser alone.
3. `overview-customize` watch — the disable rule applies to `tiles` only, not cards
   (`OverviewCustomize.tsx:35`): "The last remaining **summary** tile cannot be unticked".
4. `overview-attention` — draft: "The card is absent when nothing is wrong". **False.** The card is
   always rendered; only the attention strip is conditional, and the empty state reads
   **No outstanding data checks** (`OverviewPage.tsx:739-754`). Rewritten, and the condition list split
   off into its own step so no step runs past 22 words.
5. `overview-drill` — draft implied pressing a label straight off the chart. The real path is
   `selectionAdapter` → detail panel → `ApplicationSourceLink` (`OverviewPage.tsx:606-611, 671-676`;
   `SelectionDetail.tsx:22`); **Open net worth records** and **Open spending** are that link's labels.
6. `overview-data-status` — draft: amber when "a month or more behind **the others**". Amber is
   measured against the **balances** alone (`freshness.ts:20-23`). Corrected.
7. `overview-up-next` — draft: "then at most one payday" reads as ordering. The payday rule is a *cap*
   after the soon-deadline sort (`upNext.ts:14-31`); `UP_NEXT_WINDOW_DAYS = 45` and `UP_NEXT_LIMIT = 5`
   confirmed. Added **Open calendar** (`OverviewPage.tsx:733`) as the third step.

**Net worth**

8. `networth-stack-by` — draft chips "**Group**, **Owner**, **Share %**". Real labels: **By group**,
   **By owner**, **Share %** (`netWorthChartOptions.ts:82-86`). Also stopped bolding *Stack by*: it is
   the Segmented's `ariaLabel`, not visible text.
9. `networth-what-moved` — draft chips "**Group** / **Account**" under *Break down by*. Real labels:
   **Groups** / **Accounts** (`netWorthChartOptions.ts:367`). The draft's second step restated the
   card's InfoHint nearly verbatim, so it was replaced with the viewed-month rule and the
   two-snapshots precondition (`NetWorthPage.tsx:775`).
10. `networth-past-month` — draft: "The pencil on a chip opens the monthly update". There is no
    per-chip pencil; the ribbon carries one **Edit ↗** link for the selected month
    (`MonthRibbon.tsx:166-173`). Corrected.
11. `networth-drilldown` — the eight-account cap is real (`MAX_DRILL = PALETTE.length`, and
    `palette` is an eight-tuple, `theme/tokens.ts:48, 82`); the "never recolours the survivors"
    claim is real (per-account slot in `toggleDrill`, `NetWorthPage.tsx:474-492`). Wording changed only
    to avoid echoing the card's own footer hint.
12. Card `watch` — dropped the draft's "net worth is the plain sum of every non-component balance":
    the Accounts InfoHint already says component accounts are excluded (§5.3 r6). Kept the liability
    sign trap in the spec's own em-dash form.

**Portfolio**

13. `portfolio-transaction` — submit is **Add transaction**, becoming **Add another** once the form
    has carried fields forward (`TransactionsPanel.tsx:420-430`); draft said "**Add**". Type options
    are **Buy**/**Sell**/**Split**, and a split takes a **Factor** instead of shares and price
    (`:364-396`). Carry-forward of security, account, type and date confirmed at `:215-221`.
14. `portfolio-transaction` watch — the draft's "Performance math (XIRR) needs dated transactions —
    imported rows have none until you add dates" is the Holdings InfoHint almost word for word.
    Rewritten as the money-weighted return column staying blank.
15. `portfolio-security` — submit is **Add security**, not "Add"; the fields are **Ticker**, **Name**,
    **Industry**, **Holding type** and the **Manual price** tick, with **Annual dividend** and
    **Active** appearing only while editing (`SecuritiesPanel.tsx:180-250`). The draft's field list was
    a paraphrase and is now verbatim.
16. `portfolio-manual-price` — the row's button is **Set price**, which opens a **Price** box with
    **Save price** (`:294-327`); the draft skipped **Set price** entirely.
17. `portfolio-dividend` — submit is **Add dividend**; fields are **Security**, **Account**,
    **Pay date**, **Amount** (`DividendsPanel.tsx:287-346`). The draft's second step restated the
    card's InfoHint; rewritten. The auto/manual trap moved to a watch line grounded in
    `undoable = dividend.source !== 'auto'` (`:176-180`) — deleting an auto row cannot be undone.
18. `portfolio-targets` — the button is **Set targets** (none saved) / **Edit targets** (some saved) /
    **Close editor**, not "**Edit**" (`AllocationTargetEditor.tsx:29-33`). Rows take **Target (%)** and
    **Tolerance (pp)**; **Add category** is a label beside its own **Add** button. The exactly-100 %
    activation rule confirmed (`totalUnits !== 1_000_000`, `:128-133`).
19. `portfolio-classify` — added the real filter chips **Unclassified** / **Not reviewed** and the
    **Find a security** box; **Show all securities** appears only when a filter or search empties the
    table, not as a general "lift the filter" button (`ClassificationEditor.tsx:75-85`).
20. `portfolio-benchmarks` — the whole draft was the Performance InfoHint restated. Rewritten around
    the four real series names **Portfolio value**, **Cost basis**, **S&P 500 baseline**,
    **VOO (your contributions)** and the **Live** dot (`historyChartOptions.ts:246-252, 277`), plus
    the legend and the All-scope rule.
21. `portfolio-deactivate` — draft: "a red chip under the title". It is a listed ticker with its
    reason on hover, in the subheader under the status line (`PortfolioPage.tsx:545-564`). The revival
    path is the **Active** checkbox on the security, not a vague "bring it back from Manage".
22. `portfolio-holding-detail` — dropped the draft's "switching owner closes it too": nothing in the
    source closes the drill on a scope change (the panel only folds when the ticker is absent from the
    scoped holdings, `PortfolioPage.tsx:218-226`).
23. `portfolio-import-order` — sharpened with the real override rule: a re-import rewrites rows the
    sheet covers, and rows dated past its last date survive (`importer/apply.py:351-360`).
24. Card `watch` — dropped the draft's "A holding's industry comes from its classification, not the
    price feed": a security carries its own **Industry** field too, so the claim is not cleanly true.
    Replaced with the dated-transactions rule.

**Spending**

25. `spending-flow-window` `where` — the card title is templated (``Where ${flowPeriod.label} went``,
    `SpendingPage.tsx:643`), so the draft's segment *Where the period went* does not exist in the UI
    and would have failed the where fence. Changed to `Where <period> went` (angle-bracket placeholder,
    exempt).
26. `spending-heatmap` — the strip order is **Absolute**, **Row**, **vs average**
    (`spendingChartOptions.HEATMAP_MODES`), not the draft's Row/vs average/Absolute. A cell click opens
    a panel carrying **Open monthly entries** (`SpendingPage.tsx:815-818`), which the draft omitted.
27. `spending-trends` — the category chips exist only in the **Compare** view (`:752-766`), so that is
    now step 1. The dashed-budget and own-scale sentences were the card's InfoHint verbatim; both
    rewritten.
28. `spending-budget-seed` — **Start from my averages** is the *empty-state* button and
    **Re-seed from averages** replaces it once budgets exist (`BudgetPanel.tsx:345-358, 417-431`); the
    draft read as though both were always present. `MIN_SEED_MONTHS = 3` confirmed (`budgetSeed.ts:7`).
29. `spending-budget-set` / `-end` `where` — dropped the draft's "→ a category row" segment (not UI
    text). The **Effective from** default is the focused month (`:96-101`) ✓. The watch line was
    reworded off the on-screen editor hint so the guide is not a second copy of it.
30. `spending-yearly` — rewritten: the draft restated the Yearly rollups InfoHint. Now uses the real
    row labels **Months matched** and **Total** (`:925-958`).
31. `spending-movers` — the draft's single sentence was the InfoHint again; rewritten around the real
    columns (month, vs prior month, vs 12-mo avg, vs budget when budgets exist). `MOVERS_TOP = 5`
    confirmed (`:57`).
32. Card `watch` — added the kind-change trap ("recomputes every month, chart and projection that
    reads it", `settings/CategoriesCard.tsx:224`), and named the kinds **Living**/**Tax**/**Transfer**
    as rendered (`:29-32`).

**Credit cards**

33. `cards-add` — the title-row button reads **+ Add card** while the form's submit reads **Add card**
    (`CreditCardsPage.tsx:330-335`; `CardsPanel.tsx:420-423`); the draft used "Add card" for both. The
    point-value label is **Point value (¢)**, not "Point value" (`CardsPanel.tsx:352`).
34. `cards-opened-date` — draft: "year two is badged as falling off 5/24". There is no roster badge;
    the *year-2 anniversary calendar event's detail* carries the note
    (`calendar/generators/cards.py:16, 45-56`). Corrected to say so.
35. `cards-owner` — the Owner select's empty option is *labelled* **Joint** (`CardsPanel.tsx:369`), so
    "leave **Owner** blank" is wrong. The draft's scope sentence also restated the page's `ownerHint`
    verbatim (`CreditCardsPage.tsx:344`); rewritten around the Manage exception (`:182-197`).
36. `cards-category-add` — the real label is **Spending category (for auto weight)**
    (`CategoriesPanel.tsx:331`); submit is **Add category** (`:362`). **Pin to card** confirmed.
37. `cards-multipliers` — **Clear cell** resets the draft cell to blank = N/A
    (`RewardsMatrix.tsx:341-380`), so "makes the card unusable for that category" was reworded to the
    N/A rule. **Multiplier** / **Effective %** are two buttons in one group, not a single toggle.
38. `cards-detail` `where` — the draft's "a card's column header" is not UI text and would have failed
    the where fence; changed to `Rewards matrix`. Added the fact that the drill deliberately ignores
    the **Whose** chips (`CreditCardsPage.tsx:190-197`).
39. `cards-credit-add` — the toggle reads **Counts ✓**, not "Counts" (`CardDetail.tsx:342`); the label
    box is **Credit label** (`:366-370`). Added the watch that an anniversary reset needs the opened
    date before it reaches the calendar (`cards.py:81-84`).
40. `cards-limit-add` — **the draft put this on the wrong view.** The limit form lives in the card
    detail, which opens from the **Rewards** matrix; the **Credit lines** view carries only the
    *Credit line history* chart (`CreditCardsPage.tsx:484-497`; `CardDetail.tsx:398-476`). `where` and
    `to` corrected (`to: '/credit-cards'`, not `?section=lines`). The **New limit** placeholder named;
    the one-event-per-date rule confirmed as a DB constraint
    (`UniqueConstraint("card_id", "effective_date")`, `models/credit_cards.py:139`).
41. `cards-categories-seed` — dropped "fourteen rows" (a fact, not a rule — §5.3 r5), though
    `SEED_CATEGORIES` does have fourteen entries.
42. `cards-utilization` `where` — same correction as 40: the section is inside the card detail on
    **Rewards**.
43. Card `watch` — added "Cards are dashboard-only — a workbook import never touches them"
    (`CardsPanel.tsx:304`). The undo trap is exact: Undo re-creates the card, its credits and its limit
    events, and the toast itself says multipliers were not restored (`CardsPanel.tsx:248-288`).

### Voice pass (`8b4f626`)

A script extracted every `InfoHint text=` / `hint=` string in non-test `src/` (239 of them) and
compared every five-word span against all 178 quoted lines in this file (§5.3 r8). Six lines came back
as verbatim echoes and were rewritten: the Category-trends dashed-step and own-scale lines, the
credit-card "either of you can hold" line, the securities-delete watch line, and two Yearly-rollups
lines. The scan now returns **zero** overlaps.

Also in that commit: the Credit cards `purpose` trimmed 27 → 24 words (§5.3 r9, ≤ 25); the Overview
attention step and the Portfolio refresh step each split in two so no step exceeds 22 words (all steps
are well under the 160-character fence; the longest is 148). Checked and clean: no "simply"/marketing
words, no exclamation marks, no "below"/"above", no personal data (the only tickers named are the
product's own benchmark series labels **S&P 500 baseline** / **VOO (your contributions)**, and the
per-member button is written `**Open <TICKER>**`).

### Deviations from the plan

- **Four `where` strings in the draft name text that does not exist in the UI** and would have failed
  the where fence: *Where the period went*, *a category row*, *a card's column header*, *Card detail*.
  All replaced (items 25, 29, 38, 40/42 above).
- **`cards-limit-add`'s `to` changed** from `/credit-cards?section=lines` to `/credit-cards` — the form
  is not on that view (item 40).
- Several tasks gained a step (never more than five, the type's limit is six) where the draft merged
  two distinct actions into one sentence.
- `watch` lines are **plain prose with no `**Label**` spans**, per the coordinator's mid-task note
  (GuideCard/GuideTaskList do not run watch lines through `renderSteps` today, so asterisks would print
  literally). Nothing in this file needs the renderer change to read correctly.

### Hand-offs

- **Lane V** — watch lines here are prose-only, so V's fence extension has nothing to check in this
  file and the renderer change cannot regress it. If V decides watch lines *should* name controls in
  bold once `renderSteps` is wired, the candidates in this file are `Living spending` (Overview),
  `Whose` (Overview), `Delete` (Portfolio) and `Monthly budget` (Spending) — all verbatim in source.
- **Lane V** — `page-overview` deliberately has **no `views` key**: Overview has no tab strip, and the
  fence rejects `views` on such a page. Not an omission.
- **Lane V** — the required-coverage assertion (§5.4) is still `skipIf`-skipped; this lane's share of
  its ids (`portfolio-transaction`, `portfolio-security`, `portfolio-classify`, `cards-add`,
  `cards-multipliers`, `cards-credit-add`, `cards-owner`) all exist.
- **Lanes G1/G4** — pointer targets this lane relies on are the real destinations, not guide anchors:
  `/settings?section=household#accounts` (from `networth-accounts-pointer`),
  `/update?step=spending` (from `spending-enter-pointer`), `/settings?section=data#import` (from
  `portfolio-import-order`). If G4 renames a Settings card id, this file's links move with it.
- **No renderer requests.** Nothing in `src/guide/*.tsx` needed to change for this content.
