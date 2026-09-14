# Lane G1 — Guide content: Start here + Routines (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, one card per task, the fences as the
> test, then a spec-compliance review — voice, facts, coverage — and a code-quality review,
> then a local merge to main — never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane writes the
**Start here** and **Routines** chapters (§5.1) under the writing rules in **§5.3**. Read §0,
§4, §5 before Task 1. Source material: `docs/superpowers/specs/2026-09-14-onboarding-guide-research.md`
§5.1 (S1–S4), §5.2 (R1–R3), §6, and the file pointers in its Appendix A.

**Goal:** the two chapters a brand-new reader needs first — what the dashboard is, how it is
organized, the first-time setup checklist in dependency order, and the three routines (the
monthly update in full, tax season, keeping it healthy) — as data in `src/guide/content/start.tsx`
and `routines.tsx`, green under every fence, in the house voice.

**Architecture:** content only. The renderer, the page and the fences exist (lane G0). Cards are
`GuideCard` records; Start-here cards are prose (`body`) with `<Link>`s; the monthly update is
the guide's longest task card and the `/update` route's home for the completeness fence. Lane
G1 deletes `/update` from `PENDING_PAGES`.

**Tech stack:** TypeScript 5.9 (`strict`, `noUnusedLocals`; type-only imports use
`import type`), React 19 JSX in `.tsx`, react-router-dom `Link`, vitest 3 for the fences.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g1`, branch
  `guide/g1-start`, cut from `main` **after G0 has merged** (verify: `git log --oneline -1 main`
  mentions the guide fences, and `src/guide/content/pending.ts` exists). From the repo root:
  `git worktree add -b guide/g1-start .worktrees/guide-g1 main`, then work ONLY inside it.
- Every command below runs from the worktree root in Git Bash. `npx vitest run src/guide` runs
  the guide suites (fences included); `npx tsc -b` type-checks; `npx eslint src/guide` lints.
- Files this lane may edit: `src/guide/content/start.tsx`, `src/guide/content/routines.tsx`,
  `src/guide/content/pending.ts` (delete `'/update'` only). Nothing else. A renderer change you
  want goes in the hand-off list at the end.
- Commit after every task with the prefix shown. Never push.

## Writing rules this plan encodes (spec §5.3 — the reviewer checks them)

1. Verb first, one task per item; steps ≤ 15 words where possible, never over 160 characters
   (the fence); 1–6 steps.
2. On-screen labels **bold and verbatim** — `**Save and close month**`, not `**save & close**`.
   The label fence requires the exact string to exist somewhere in `src/**/*.ts(x)`. Before
   committing, verify each bold label against the **Source** lines listed in the task:
   `grep -rnF -- "Label" src --include=*.tsx --include=*.ts | grep -v test`. If it is missing,
   use the real label; if the real label is templated (`Start {month}`), write a placeholder in
   angle brackets (`**Start <Month>**`) — placeholders are exempt.
3. Where paths use ` → ` between places and ` · ` between alternatives; segments must be page
   names, view labels or text that exists in the UI (fence).
4. One trap per *Watch out* line, rule plus consequence, the house em-dash clause.
5. Say what is not saved, not undoable, not per-person, not pre-filled.
6. No marketing words, no "simply", no exclamation marks, no numbers unless the number is the rule.
7. Never restate an `InfoHint` sentence — after writing a card, grep a distinctive five-word span
   of each step; a verbatim hit in a component means rewrite the step to say *how*, not *what*.
8. Describe the current tabs; never "below"/"above" for content on another view.
9. No personal data: no names, tickers, amounts, dates from the owner's book.
10. Cross-lane guide anchors are forbidden (they would fail the link fence until the other lane
    lands): link to the real page/view/Settings card instead; lane V adds the few guide
    cross-links (spec §9). Links inside this lane's own two files are fine.

## Draft copy

The card literals below are **draft copy**. The implementer pastes them, verifies every label
and fact against the Source lines, corrects what the source contradicts, runs the fences, and
only then commits. Where a step describes a behaviour, the source line that proves it is listed.

---

## Task 1 — Start here: How it is organized · Set up once · What happens next (spec §5.1)

**Files:**
- Modify: `src/guide/content/start.tsx` (append three cards after the exemplar `start-what`)
- Test: `src/guide/guideContent.test.ts` (fences), `src/pages/GuidePage.test.tsx` (unchanged)

**Source for verification:** `src/components/navItems.ts` (group headings, labels),
`src/components/shell/ScopeBar.tsx:66-70` (All / 1Y / YTD), `src/components/shell/MonthRibbon.tsx:22-35`
(two-tone chips), `src/components/Layout.tsx:186-190` (palette row, `Ctrl K`),
`src/components/InfoHint.tsx`, `src/components/details/MetricInspector.tsx:24-65` (About this
number, Explain this number), `src/components/assistant/AssistantDrawer.tsx` (launcher aria-label
"Open assistant"), `src/components/ToastProvider.tsx:41` (six seconds),
`src/components/settings/ActivityCard.tsx:124`, `src/components/shell/SidebarFooter.tsx`,
`src/components/settings/HouseholdCard.tsx:68-119`, `AccountsCard.tsx:293-385`,
`CategoriesCard.tsx:116-226`, `LimitsCard.tsx:136-205`, `PlanAssumptionsCard.tsx:166-250`,
`PriceRefreshCard.tsx:100-200`, `CalendarFeedCard.tsx:105-241`, `BackupsCard.tsx:60-96`,
`src/pages/SettingsPage.tsx:379-442` (import), `src/components/spending/BudgetPanel.tsx:120-175`
(three complete months), `src/pages/MonthlyUpdatePage.tsx:1647` (Next disabled at zero accounts).

- [ ] **Step 1: Run the fences to see the current state**

Run: `npx vitest run src/guide/guideContent.test.ts`
Expected: PASS with the coverage suite skipped (thirteen pending routes).

- [ ] **Step 2: Append the three cards**

In `src/guide/content/start.tsx`, after the `start-what` card inside `START_CARDS`:

```tsx
  {
    id: 'start-organized',
    title: 'How it is organized',
    purpose:
      'Thirteen pages in four groups, a tab strip on most pages, one sticky row for scope, and a few shell controls that work everywhere.',
    tasks: [],
    body: (
      <>
        <ul className="guide-body">
          <li>
            <b className="guide-label">Overview</b> and <b className="guide-label">Monthly update</b> sit on top: the
            briefing, and the one place data is entered.
          </li>
          <li>
            <b className="guide-label">Tracking</b> — Net worth, Portfolio, Spending, Credit cards: what you have and
            what you spend.
          </li>
          <li>
            <b className="guide-label">Income</b> — Paycheck, Comp, ESPP: what you earn and how it arrives.
          </li>
          <li>
            <b className="guide-label">Planning</b> — Taxes, Projection, Calendar: what is ahead.
          </li>
          <li>
            <b className="guide-label">Guide</b> and <b className="guide-label">Settings</b> close the sidebar.
          </li>
        </ul>
        <p className="guide-body">
          Most pages have tabs under their title — their views. The address keeps the view, so Back works and a
          link opens the same view for someone else.
        </p>
        <p className="guide-body">
          The sticky row under the title holds the scope: <b className="guide-label">Whose</b> (All, each person,
          Joint), the time window (<b className="guide-label">All</b> · <b className="guide-label">1Y</b> ·{' '}
          <b className="guide-label">YTD</b>) and, on pages that have one, the month ribbon — twelve chips whose left
          half fills when the month has balances and right half when it has spending, with a ring on the current
          month.
        </p>
        <p className="guide-body">
          <b className="guide-label">Ctrl K</b> (⌘K on a Mac) opens the command palette: pages, Settings cards,
          actions, holdings, accounts, categories, cards — and every task in this guide.
        </p>
        <p className="guide-body">
          An ⓘ beside a title explains that card in a sentence. <b className="guide-label">About this number</b> on a
          tile opens its receipt — definition, window, the months it counted, its source — with{' '}
          <b className="guide-label">Explain this number</b> to hand it to the assistant.
        </p>
        <p className="guide-body">
          The ✦ button at the bottom right opens the assistant once a key is saved in{' '}
          <Link to="/settings?section=integrations#assistant">Settings → Integrations → Assistant</Link>. Nothing is
          sent until you ask a question.
        </p>
        <p className="guide-body">
          Saving shows a toast for six seconds; many carry <b className="guide-label">Undo</b>.{' '}
          <Link to="/settings?section=data#activity">Settings → Data → Activity</Link> keeps every money-bearing
          change with a durable Undo.
        </p>
        <p className="guide-body">
          The sidebar footer shows who is signed in, which deployment this is, a theme toggle and{' '}
          <b className="guide-label">Log out</b>.
        </p>
      </>
    ),
  },
  {
    id: 'start-setup',
    title: 'Set up once',
    purpose:
      'The first-time checklist, in the order the data depends on itself — people before the things they own, accounts before the first month, category kinds before history.',
    tasks: [],
    body: (
      <ol className="guide-body">
        <li>
          <Link to="/settings?section=account#appearance">Appearance</Link> — theme, density, landing page. Works before
          any data exists.
        </li>
        <li>
          <Link to="/settings?section=account#password">Password</Link> — change the seeded one. Every other device is
          signed out.
        </li>
        <li>
          <Link to="/settings?section=household#household">Household</Link> — <b className="guide-label">Add member</b>{' '}
          for each person; set the marriage date if you are married. It drives joint filing; nothing is backfilled.
        </li>
        <li>
          <Link to="/settings?section=household#accounts">Accounts</Link> — every account with its{' '}
          <b className="guide-label">Group</b>, <b className="guide-label">Owner</b> (blank = joint) and sort order.
          Without one account the monthly wizard cannot leave Balances. Liabilities are entered negative.
        </li>
        <li>
          <Link to="/settings?section=household#categories">Spending categories</Link> — add them and set each
          one\u2019s kind (<b className="guide-label">Living</b> · <b className="guide-label">Tax</b> ·{' '}
          <b className="guide-label">Transfer</b>) before entering months — a kind change recomputes all history.
        </li>
        <li>
          If you have the workbook: <Link to="/settings?section=data#import">Import workbook</Link> —{' '}
          <b className="guide-label">Dry run</b>, read the diff, <b className="guide-label">Apply import</b>. Do this
          before editing sheet-covered tax years in the UI — the sheet wins there.
        </li>
        <li>
          <Link to="/update">Monthly update</Link> — your first month: Balances → Spending → Review →{' '}
          <b className="guide-label">Save progress</b>, tick the three confirmations,{' '}
          <b className="guide-label">Save and close month</b>. The full routine is in{' '}
          <Link to="/guide?section=routines#routine-monthly">Routines</Link>.
        </li>
        <li>
          <Link to="/settings?section=integrations#price-refresh">Price refresh</Link> — set the schedule with day names
          and keep Mondays covered (the Monday run records the weekly performance point), then{' '}
          <b className="guide-label">Refresh now</b>.
        </li>
        <li>
          <Link to="/portfolio?section=manage">Portfolio → Manage</Link> — securities and dated transactions the import
          did not carry; manual prices for private assets. Then <Link to="/portfolio?section=allocation">Allocation</Link>{' '}
          for classifications and targets.
        </li>
        <li>
          <Link to="/settings?section=planning#limits">Contribution limits</Link> for this year (the app ships none;
          blank means not entered) and <Link to="/settings?section=planning#plan-assumptions">Plan assumptions</Link>{' '}
          — withdrawal rate, ESPP ticker and discount.
        </li>
        <li>
          <Link to="/taxes">Taxes</Link> — <b className="guide-label">New tax year…</b>, filing status, tax tables,
          inputs. See <Link to="/guide?section=routines#routine-tax-season">Tax season</Link>.
        </li>
        <li>
          <Link to="/paycheck?section=profiles">Paycheck → Profiles</Link> — one profile per person: salary, pay
          periods, contribution percentages, HSA, employer match, the optional withholding split.
        </li>
        <li>
          <Link to="/comp?section=manage">Comp → Manage</Link> for grants and focal history;{' '}
          <Link to="/espp?section=lots">ESPP → Lots</Link> for offerings and lots.
        </li>
        <li>
          <Link to="/credit-cards?section=manage">Credit cards → Manage</Link> — cards with their{' '}
          <b className="guide-label">Opened</b> dates, then categories and multipliers.
        </li>
        <li>
          <Link to="/settings?section=integrations#calendar">Calendar feed</Link> — the monthly reminder day and a
          subscription link for your phone.
        </li>
        <li>
          <Link to="/settings?section=data#backups">Backups</Link> — <b className="guide-label">Snapshot now</b> once,
          and confirm the nightly 23:30 PT job writes.
        </li>
        <li>
          After three complete months: <Link to="/spending?section=budgets">Spending → Budgets</Link> →{' '}
          <b className="guide-label">Start from my averages</b>.
        </li>
      </ol>
    ),
  },
  {
    id: 'start-next',
    title: 'What happens next',
    purpose: 'Three rhythms after setup: every month, every year, and whenever something changes.',
    tasks: [],
    body: (
      <ul className="guide-body">
        <li>
          <b>Every month</b> — the <Link to="/guide?section=routines#routine-monthly">monthly update</Link> in the
          first days of the month, then a look at <Link to="/">Overview → Needs attention</Link>.
        </li>
        <li>
          <b>Every year</b> — <Link to="/guide?section=routines#routine-tax-season">tax season</Link>: a new tax year,
          its tables, this year\u2019s contribution limits.
        </li>
        <li>
          <b>Whenever</b> — a raise or an election change: a new <Link to="/paycheck?section=profiles">paycheck profile</Link>.
          A grant: <Link to="/comp?section=manage">Comp</Link>. An enrollment window:{' '}
          <Link to="/espp?section=lots">ESPP</Link>. A new card: <Link to="/credit-cards?section=manage">Credit cards</Link>.
          A question about the future: the sandboxes on <Link to="/paycheck?section=changes">Paycheck</Link>,{' '}
          <Link to="/taxes?section=whatif">Taxes</Link> and <Link to="/projection">Projection</Link> — nothing in
          them is saved.
        </li>
        <li>
          <b>When a number looks wrong</b> — <Link to="/guide?section=routines#routine-health">Keeping it healthy</Link>.
        </li>
      </ul>
    ),
  },
```

`\u2019` is the typographic apostrophe the house copy uses in JSX text; inside JSX children write
it as `{'\u2019'}` or paste the character `’` directly — either is fine, the fence does not read
`body`.

- [ ] **Step 3: Verify labels and facts**

For each `guide-label` in the three cards, grep the source (rule 2). Check the facts against the
Source lines: the range chips are `All`/`1Y`/`YTD`; the palette hint reads `Ctrl K`; the ribbon
comment describes left = balances, right = spending; the toast constant is 6000 ms; the nightly
snapshot is 23:30 PT (`BackupsCard.tsx`); the budget seed needs three complete months
(`MIN_SEED_MONTHS` in `BudgetPanel.tsx`).

- [ ] **Step 4: Run the fences, the type-check and lint**

Run: `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`
Expected: PASS (the three guide-internal links `#routine-monthly`, `#routine-tax-season`,
`#routine-health` will FAIL the hash fence until Task 2–3 land those cards — if you commit Task 1
alone, expect exactly those three failures and fix them by finishing Tasks 2–3 before the lane's
final gates; alternatively commit Tasks 1–3 together as one commit).

- [ ] **Step 5: Commit**

```bash
git add src/guide/content/start.tsx
git commit -m "content(guide): Start here — how it is organized, the first-time setup checklist, what happens next (spec §5.1)"
```

---

## Task 2 — Routines: The monthly update (spec §5.1 `routine-monthly`)

**Files:**
- Modify: `src/guide/content/routines.tsx`

**Source for verification:** `src/pages/MonthlyUpdatePage.tsx` — stepper `:1291-1305`; month
pick and `Start <Month>` `:1103-1119, 1316-1320`; balances seeding `:503-556, 1124-1152`;
`Recorded on`/`Notes` `:1413-1433`; liability cue and **Flip sign** `:1541-1558, 1619-1621`;
components/derived `:198-262, 1478-1519`; paste `:1164-1236`; **Next: spending** `:1647`;
spending step `:1656-1806` (**Household take-home** `:1675`, `Typical (3-mo median)` `:1691`,
**Confirm remaining categories as $0** `:1763-1776`); review tiles and save `:840-959, 1904-1934`;
receipt `:151-179, 1373-1388`; confirmations legend `Confirm this month is complete` `:1896`,
checkbox sentences `:1895-1902`, **Save and close month** `:1935`; drafts `:73-129, 651-694,
1361-1372`; phantom banner `:1033-1071, 1349-1360`; Month actions `:1817-1859`; conflict banner
`:954, 1348`; undo `:904-919`. `src/components/monthly/ReviewChanges.tsx:53` (`Changes since last
save`), `src/components/monthly/HistoricalReview.tsx:87-112` (**Load history**, **Select all
eligible**, **Close selected months**, `Review entries`). `src/components/settings/CalendarFeedCard.tsx:211-241`
(reminder day). `src/utils/paste.ts:28-70`.

- [ ] **Step 1: Write the card**

Replace the empty array in `src/guide/content/routines.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Routines (2026-09-14 guide spec §5.1) — the monthly update (the /update route's home
// for the completeness fence), tax season, keeping it healthy.
export const ROUTINE_CARDS: GuideCard[] = [
  {
    id: 'routine-monthly',
    title: 'The monthly update',
    purpose:
      'The one place balances, spending and take-home are entered — three steps, one save, an explicit close. Do it in the first days of the month for the month just ended.',
    to: '/update',
    keywords: ['monthly update', 'wizard', 'enter balances', 'month end', 'ritual'],
    body: (
      <p className="guide-body">
        Before you start: each account\u2019s month-end balance, the month\u2019s spend per category, and the
        household\u2019s take-home for the month. The reminder day (
        <Link to="/settings?section=integrations#calendar">Settings → Integrations → Calendar feed</Link>) puts
        &ldquo;Monthly update&rdquo; on the calendar with an alarm three days before.
      </p>
    ),
    tasks: [
      {
        id: 'update-pick-month',
        title: 'Pick the month',
        where: 'Monthly update → month ribbon',
        steps: [
          'Click a month chip — its left half fills when balances exist, its right half when spending does.',
          'For the next uncovered month, press **Start <Month>** in the title row instead.',
          'A month with no balances yet always opens on **Balances**; otherwise the step you were on survives the switch.',
        ],
        to: '/update',
        keywords: ['which month', 'ribbon', 'start month'],
      },
      {
        id: 'update-balances',
        title: 'Enter balances',
        where: 'Monthly update → Balances',
        steps: [
          'Type each account\u2019s month-end balance in **This month**; **Last month** and **Δ** sit beside it as a typo check.',
          'Enter card and loan balances as negative numbers — a positive one shows a cue and a **Flip sign** button.',
          'Type into component accounts; the parent is read-only and rolls up on its own.',
          'Set **Recorded on** and an optional **Notes** line for the month.',
          'Paste a column from a spreadsheet into the first cell you want filled — the status line says what landed.',
          'Press **Next: spending**, or Enter on the last cell.',
        ],
        to: '/update?step=balances',
        keywords: ['balances', 'account balance', 'net worth entry', 'liability'],
      },
      {
        id: 'update-spending',
        title: 'Enter spending and take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Type the household\u2019s take-home for the month in **Household take-home** — one figure, not per person.',
          'Type each category\u2019s spend in **This month**; **Typical (3-mo median)** sits beside it for context.',
          'Leave a category blank if you do not know it — blank is not entered, not zero.',
          'To record a month with nothing in the remaining categories, tick **Confirm remaining categories as $0**.',
          'A budgeted category shows its budget underneath and turns red when over — advisory, never a block.',
        ],
        to: '/update?step=spending',
        keywords: ['spending', 'take-home', 'net pay', 'categories', 'zero month'],
      },
      {
        id: 'update-review-save',
        title: 'Review and save progress',
        where: 'Monthly update → Review',
        steps: [
          'Read the four tiles and **Changes since last save** — every row you changed, before and after.',
          'Work through the items to review; each links to its field or account.',
          'Press **Save progress** — one save writes balances and spending together.',
          'Read the receipt: rows added, changed and unchanged per feed, with links to Net worth and Spending.',
          'Undo the whole save from the toast within six seconds; later, from Settings → Data → Activity.',
        ],
        to: '/update?step=review',
        keywords: ['save', 'review', 'receipt', 'undo save'],
      },
      {
        id: 'update-close',
        title: 'Close the month',
        where: 'Monthly update → Review → Confirm this month is complete',
        steps: [
          'Enter balances, spending and take-home first — a month missing any of them cannot close.',
          'Tick **I checked every account balance**, **I checked spending, tax, and transfers for the whole month** and **I checked household take-home for the whole month**.',
          'For the current month, tick the fourth box saying the figures are final although the month is still in progress.',
          'Press **Save and close month**.',
          'Change a figure later and its tick clears — the month reads Needs review until you close it again.',
        ],
        to: '/update?step=review',
        watch: ['A future month can be saved but never closed — it stays in progress until its month begins.'],
        keywords: ['close month', 'complete month', 'confirmations', 'needs review'],
      },
      {
        id: 'update-after',
        title: 'After the update',
        where: 'Overview · Spending · Net worth',
        steps: [
          'Open **Overview** and clear the **Needs attention** list — each line links to its fix.',
          'On **Spending**, read **What changed** for the month\u2019s biggest category moves.',
          'On **Net worth**, read **What moved** for the accounts behind the month\u2019s change.',
        ],
        to: '/',
        keywords: ['after update', 'check', 'what changed'],
      },
    ],
    more: [
      {
        id: 'update-historical-close',
        title: 'Close several past months at once',
        where: 'Monthly update → Review → Review historical months',
        steps: [
          'Press **Load history**.',
          'Tick the months to close, or **Select all eligible** for a year — a disabled row says which feed it is missing.',
          'Tick the confirmation for the selected months.',
          'Press **Close selected months**.',
        ],
        to: '/update?step=review',
        keywords: ['batch close', 'history', 'unreviewed'],
      },
      {
        id: 'update-delete-month',
        title: 'Delete a month',
        where: 'Monthly update → Review → Month actions',
        steps: [
          'Open the **Month actions** menu beside the review tiles.',
          'Type the month as YYYY-MM to arm the button, then press **Delete this month**.',
          'Everything for that month goes — the balances snapshot, its account rows, spending and take-home.',
          'Undo from the toast within six seconds.',
        ],
        to: '/update?step=review',
        keywords: ['delete month', 'remove month'],
      },
      {
        id: 'update-clear-take-home',
        title: 'Clear a saved take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Blank the **Household take-home** box on a month that had one.',
          'Save — the month\u2019s cashflow row is deleted and the receipt says so.',
        ],
        to: '/update?step=spending',
      },
      {
        id: 'update-paste',
        title: 'Paste from a spreadsheet',
        where: 'Monthly update → Balances · Spending',
        steps: [
          'Copy one column of numbers, click the first cell to fill, paste — values fill downward in table order.',
          'Copy two columns (name, value) and paste anywhere — rows match by name; unmatched names are listed, never guessed.',
          'Empty cells are skipped, not blanked; the status line reports what landed and what did not.',
        ],
        to: '/update',
        keywords: ['paste', 'spreadsheet', 'clipboard'],
      },
      {
        id: 'update-phantom',
        title: 'Repair a month saved with no spending',
        where: 'Monthly update → repair banner',
        steps: [
          'A month with zero-filled spending and no take-home shows a repair banner — averages read it as spent nothing.',
          'Enter the real spending, or press **Delete the empty month** to drop the zero rows and keep the balances.',
        ],
        to: '/update?step=spending',
        keywords: ['phantom month', 'zero month', 'repair'],
      },
      {
        id: 'update-drafts',
        title: 'Recover unsaved entries',
        where: 'Monthly update',
        steps: [
          'Every keystroke is kept in this browser tab; reopening the month shows **Restored unsaved entries**.',
          'Keep typing, or press **Discard restored entries** to return to what the server holds.',
        ],
        to: '/update',
        keywords: ['draft', 'unsaved', 'restore entries'],
      },
      {
        id: 'update-conflict',
        title: 'Resolve a save conflict',
        where: 'Monthly update → conflict banner',
        steps: [
          'If the month changed on the server while you typed, saving stops with a banner.',
          'Press **Reload latest and compare draft** — your draft is kept beside the fresh values.',
        ],
        to: '/update',
      },
    ],
    watch: [
      'Saving progress and closing are different — only a closed month counts as complete for comparisons, averages and projection defaults.',
      'Balances are pre-filled from last month; spending never is — its cells start at 0.00 beside the Typical column.',
      'Blank is not entered, never zero — a month with no spending needs the $0 confirmation to save as zeros.',
      'Liabilities are entered as negative numbers — a positive card balance inflates net worth.',
      'Unsaved entries live in this browser tab only — the next visit offers to restore or discard them.',
    ],
  },
]
```

- [ ] **Step 2: Verify labels and facts**

Grep every bold label (rule 2) — in particular the three confirmation sentences at
`MonthlyUpdatePage.tsx:1895-1902` (copy them character for character), `Next: spending` (`:1647`),
`Typical (3-mo median)` (`:1691`), `Changes since last save` (`ReviewChanges.tsx:53`),
`Restored unsaved entries` and `Discard restored entries` (`:1361-1372`), `Delete the empty month`
(`:1349-1360`), `Reload latest and compare draft` (`:1348`), `Month actions` (`:1823`),
`Delete this month` (`:1838-1850`), `Load history` / `Select all eligible` / `Close selected months`
(`HistoricalReview.tsx:87-112`). Confirm the facts: the step survives a month switch except for a
month with no balances (`:1103-1110`); a future month cannot close (`services/month_review.py:105-133`);
the "$0" consent is forgotten on a month switch (`:369-371`).

- [ ] **Step 3: Run the fences**

Run: `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`
Expected: PASS except the completeness fence's `/update` entry now being **both** covered and
pending — the "a pending route has no card yet" test FAILS naming `/update`. That is Task 4's
edit; do it now if you prefer one green commit: delete `'/update'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/routines.tsx src/guide/content/pending.ts
git commit -m "content(guide): Routines — the monthly update, thirteen tasks and the five traps; /update leaves the pending list (spec §5.1)"
```

---

## Task 3 — Routines: Tax season · Keeping it healthy (spec §5.1)

**Files:**
- Modify: `src/guide/content/routines.tsx` (append two cards)

**Source for verification:** `src/pages/TaxesPage.tsx:590-651` (**New tax year…**, **Create
year**), `:443-469, 768-786` (**Filing status**), `src/components/taxes/BracketsEditor.tsx:184-209,
329-370, 406-433` (rates/thresholds rules, **Clone from <year> single tables**, **Add a table for
<person>**), `SummaryPanel.tsx:264-307` (refusal reads "—", **Open Tax tables**), `InputsForm.tsx:650-841`
(**Save inputs**, **Apply** chips), `WithholdingPanel.tsx:262-295` (vest **Apply**), `src/components/settings/LimitsCard.tsx:136-205`
(**Save limits**, **Clone from <year>**), `src/components/overview/attention.ts:55-262`,
`src/pages/OverviewPage.tsx:739-753`, `src/components/details/MetricInspector.tsx:24-65`,
`src/components/settings/HealthCard.tsx:20-135`, `BackupsCard.tsx:60-96`, `ActivityCard.tsx:100-200`,
`src/pages/PortfolioPage.tsx:423-435, 545-564` (**Deactivate**).

- [ ] **Step 1: Append the two cards**

After the `routine-monthly` card:

```tsx
  {
    id: 'routine-tax-season',
    title: 'Tax season, once a year',
    purpose:
      'Once a year, when the IRS and the Franchise Tax Board publish the figures: a new tax year, its tables, this year\u2019s contribution limits.',
    keywords: ['tax season', 'new year', 'brackets', 'yearly'],
    tasks: [],
    body: (
      <ol className="guide-body">
        <li>
          <Link to="/taxes">Taxes</Link> → <b className="guide-label">New tax year…</b> → type the year →{' '}
          <b className="guide-label">Create year</b>. The newest year that has tables is cloned.
        </li>
        <li>
          Scope row → <b className="guide-label">Filing status</b>. Every year starts Single.
        </li>
        <li>
          <Link to="/taxes?section=tables">Tax tables</Link> → for that status, enter or refresh Federal, State,
          Medicare, Social Security, Disability and Capital gains. Rates as percents; thresholds ascending from 0; at
          most twelve rows.
        </li>
        <li>
          Married year: on the status tab press <b className="guide-label">Clone from</b> the single tables, then edit
          the tables badged &ldquo;review thresholds&rdquo;. Social Security and Disability copy verbatim — they are
          per worker.
        </li>
        <li>
          An earner on a different plan: <b className="guide-label">Add a table for</b> that person under Social
          Security or Disability.
        </li>
        <li>
          <Link to="/taxes?section=inputs">Inputs</Link> → the year\u2019s line items. Grey derived rows compute
          themselves; <b className="guide-label">Apply</b> chips carry last year\u2019s deductions forward.{' '}
          <b className="guide-label">Save inputs</b>.
        </li>
        <li>
          <Link to="/settings?section=planning#limits">Settings → Planning → Contribution limits</Link> → the year →
          the published amounts, or <b className="guide-label">Clone from</b> last year. The Paycheck pace meters and
          the sandbox presets need them.
        </li>
        <li>
          Through the year: <Link to="/taxes">Summary → Will I owe?</Link> — its <b className="guide-label">Apply</b>{' '}
          chip writes this year\u2019s vest income into the W-2 inputs, and the remedy line gives the W-4 line 4(c) /
          DE 4 figure.
        </li>
      </ol>
    ),
    watch: [
      'The tab under Tax tables picks which tables you are editing — the year\u2019s filing status is the scope row\u2019s toggle.',
      'No tables for the year\u2019s status and every figure reads "—", not 0, with a door to Tax tables.',
      'Married filing separately keeps a permanent caveat — California is community property and the calculator does not split income.',
    ],
  },
  {
    id: 'routine-health',
    title: 'Keeping it healthy',
    purpose: 'A short loop for the weeks between updates: work the lists to empty, keep prices fresh, keep a restore point.',
    keywords: ['health', 'maintenance', 'attention', 'backup'],
    tasks: [
      {
        id: 'health-attention',
        title: 'Work the Needs attention list',
        where: 'Overview → Needs attention',
        steps: [
          'Each line is a condition the data proves — an overdue month, a stale quote, a failed ticker, a stale backup, a missing tax year.',
          'Click the line to land where it is fixed.',
          'The card is absent when nothing needs you; there is no all-clear badge.',
        ],
        to: '/',
        keywords: ['overdue', 'stale', 'attention'],
      },
      {
        id: 'health-about-number',
        title: 'Check a number that looks wrong',
        where: 'Any headline tile → About this number',
        steps: [
          'Press **About this number** on the tile.',
          'Read the definition, the window and the months it counted — a gap or an incomplete month is named there.',
          'Press **Explain this number** to hand the receipt to the assistant.',
        ],
        keywords: ['receipt', 'definition', 'wrong number', 'inspect'],
      },
    ],
    body: (
      <p className="guide-body">
        Also: <Link to="/settings?section=data#health">Data health</Link> lists zero-filled months, orphaned feeds and
        stale quotes, each with an inline fix. On <Link to="/portfolio">Portfolio</Link>, a red failure chip offers{' '}
        <b className="guide-label">Deactivate</b> for a delisted ticker and <b className="guide-label">Refresh prices</b>{' '}
        when the as-of line is amber. <Link to="/settings?section=data#backups">Backups</Link> writes nightly at 23:30 PT;
        press <b className="guide-label">Snapshot now</b> before an import or a big edit.{' '}
        <Link to="/settings?section=data#activity">Activity</Link> undoes any money-bearing change while nothing later
        touched the same rows.
      </p>
    ),
  },
```

- [ ] **Step 2: Verify labels and facts**

Grep the labels (rule 2). Confirm: brackets max 12 rows and first threshold 0 (`BracketsEditor.tsx:184-209`);
SS/Disability copy verbatim on clone (`:329-370`); every year starts Single (`TaxesPage.tsx:443-469`);
the refusal renders "—" with **Open Tax tables** (`SummaryPanel.tsx:264-307`); the health checks
listed exist (`HealthCard.tsx:20-135`).

- [ ] **Step 3: Run the fences**

Run: `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`
Expected: PASS — `#routine-tax-season` and `#routine-health` now resolve for Task 1's links.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/routines.tsx
git commit -m "content(guide): Routines — tax season and keeping it healthy (spec §5.1)"
```

---

## Task 4 — pending list, gates, hand-off

- [ ] **Step 1: Retire this lane's route** (if not already done in Task 2)

In `src/guide/content/pending.ts` delete the line `'/update',`.

- [ ] **Step 2: Full gates**

Run: `npx tsc -b && npx eslint . && npx vitest run && npm run build`
Expected: all green; the fences pass with twelve routes pending.

- [ ] **Step 3: Read the chapters in the rendered page (optional, no dev server needed)**

Run: `npx vitest run src/pages/GuidePage.test.tsx` — green means the page renders the fixture;
to eyeball the real copy, the verify lane's browser walk covers it. If a dev server is already
running on 5173, open `http://localhost:5173/guide?section=routines#routine-monthly`.

- [ ] **Step 4: Record results**

Append `## Results (implementer, <date>)`: commits, gate output (counts), every label you
changed from the draft and why (the reviewer reads this list first), deviations, hand-offs.

### Hand-offs

- **V:** upgrade `start-next`'s sandbox sentence to link `/guide?section=reference#ref-sandboxes`
  once G4 lands (spec §9 cross-link list).
- **Renderer** (G0's files, not this lane's): none expected. If `ol.guide-body` needs tighter
  list spacing, report it here for V rather than editing `GuidePage.css`.

## Self-review (done while writing)

- Spec §5.1 Start here: `start-what` (G0 exemplar, kept), `start-organized`, `start-setup`,
  `start-next` → Task 1. Routines: `routine-monthly` with the six visible + seven folded task ids
  named in the spec → Task 2; `routine-tax-season` (body sequence + three traps) and
  `routine-health` (`health-attention`, `health-about-number` + body links) → Task 3.
- Required-coverage ids owned here: `update-balances`, `update-spending`, `update-close` ✓.
- Rule 10: the only guide anchors used are this lane's own (`#routine-monthly`,
  `#routine-tax-season`, `#routine-health`) — no cross-lane anchors.
- Fences: `routine-monthly` has `to: '/update'`, six visible tasks (3–8 ✓), five `watch` lines
  (≤ 5 ✓), no `views` (the page has no strip ✓); every `to` uses allowed params (`step`) ✓.
