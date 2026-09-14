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

---

## Results (implementer, 2026-09-14)

### Commits (branch `guide/g1-start`, cut from `e0d289c`)

| SHA | Message |
| --- | --- |
| `5f36aed` | content(guide): Start here — how it is organized, the first-time setup checklist, what happens next (spec §5.1) |
| `1075dc8` | content(guide): Routines — the monthly update, thirteen tasks and the five traps; /update leaves the pending list (spec §5.1) |
| `c3b91a3` | content(guide): Routines — tax season and keeping it healthy (spec §5.1) |
| `c9622d3` | content(guide): Routines — name the two controls in watch lines as \*\*Label\*\*, ready for lane V's renderSteps pass (G3 hand-off) |

Files touched: `src/guide/content/start.tsx`, `src/guide/content/routines.tsx`,
`src/guide/content/pending.ts` (the `'/update',` line only). Nothing else.

### Gates

- Per task: `npx vitest run src/guide` → 5 files, **23 passed / 1 skipped** (the §5.4 coverage
  guard, still skipped because `PENDING_PAGES` has twelve routes left); `npx tsc -b` clean;
  `npx eslint src/guide` clean. Run after Task 1, Task 2, Task 3 and the watch-line follow-up.
- Final: `npx tsc -b` clean · `npx eslint .` → **0 errors, 25 warnings** (all pre-existing
  `react-refresh/only-export-components`, none in `src/guide`) · `npx vitest run` → **231 files,
  3093 passed, 1 skipped** · `npm run build` → built in 20.59s (`GuidePage` chunk 27.81 kB).

### Labels and facts changed from the draft copy

Every bold label and every `where` segment was grepped against non-test `src/**/*.ts(x)`. The
draft was right about most of it; these are the corrections, with the source that forced each.

**Start here**

1. `start-what` **purpose trimmed 29 → 25 words** (coordinator note, spec §5.3 rule 9): the
   trailing "and everything else is computed from those entries" became "everything else is
   computed". No other change to the exemplar.
2. `start-organized` purpose "Thirteen pages in four groups" → **"The sidebar in five groups"**.
   `navItems.ts` now has FIVE `NAV_SECTIONS` and FOURTEEN items — G0 added `/guide` — so both
   numbers in the draft were stale. The body's own list has five bullets, which now agree.
3. The ⓘ paragraph was **split in two**: `InfoHint`'s ⓘ (hover opens, click pins —
   `InfoHint.tsx:28-32`) and `MetricInfoButton`'s ⓘ are different buttons, and
   **About this number** is the latter's *accessible name* on a `StatTile` that carries evidence
   (`MetricInspector.tsx:90`, `StatTile.tsx:119`). The draft read as if one control did both.
4. "The ✦ button" → "the sparkle button … (**Open assistant**)": the icon is lucide `Sparkles`
   and `Open assistant` is the aria-label (`AssistantDrawer.tsx:923`); the launcher is
   `position: fixed; right/bottom: 1.25rem` (`assistant.css:8-19`), so "bottom right" stands.
5. Activity sentence rewritten — the draft's "keeps every money-bearing change with a durable
   Undo" restates `ActivityCard.tsx:124`'s InfoHint (rule 6). Now: "Once it is gone, … is where a
   money-bearing change is reversed."
6. `start-setup` 1: named the real controls **Theme** · **Density** · **Landing page**
   (`AppearanceCard.tsx:49,59,80`).
7. `start-setup` 2 (Password): dropped "Every other device is signed out" — verbatim from the
   card's InfoHint (`SettingsPage.tsx:318`).
8. `start-setup` 3: added **Marriage date**; dropped "It drives joint filing" (nothing in the card
   says so) and reworded the backfill clause off `HouseholdCard.tsx:231-233`'s own sentence.
9. `start-setup` 4: "**Owner** (blank = joint)" → "leave **Owner** empty for a joint one" —
   "Owner blank = joint." is `AccountsCard.tsx:287`'s InfoHint sentence, and `accounts-owner` is
   its canonical home anyway (spec §5.1). Dropped "and sort order" (no such labelled field on the
   form). Kept the no-accounts fact: `accounts.length === 0` disables **Next: spending**
   (`MonthlyUpdatePage.tsx:1643`).
10. `start-setup` 8 (Price refresh): dropped "keep Mondays covered (the Monday run records the
    weekly performance point)" — verbatim InfoHint (`PriceRefreshCard.tsx:124`). Added
    **Save schedule** and "a five-field cron in day names".
11. `start-setup` 9: manual pricing is a **security** flag on Portfolio → Manage → Securities
    (`SecuritiesPanel.tsx:95`), not a separate destination — reworded.
12. `start-setup` 10 (Limits): dropped "(the app ships none; blank means not entered)" — verbatim
    InfoHint (`LimitsCard.tsx:138`). Added **Save limits**.
13. `start-setup` 12: added the real disclosure label **Withholding split** (`PaycheckPage.tsx:845`).
14. `start-setup` 15: named **Monthly update reminder day** and **New feed link**
    (`CalendarFeedCard.tsx:198,212`).
15. `start-setup` 16: the card is **Backups & snapshots**; "confirm the nightly 23:30 PT job
    writes" dropped as an InfoHint restatement (`BackupsCard.tsx:83`) → "check the list gains a
    nightly entry".

**Routines — the monthly update**

16. Card **purpose trimmed 30 → 22 words** (rule 9); "do it in the first days of the month" moved
    into `body`.
17. `body`: dropped "with an alarm three days before" — the ICS alarm is `-P2DT15H`
    (`backend/app/services/calendar/ics.py:18`) and the event is titled "Monthly update — enter
    <Month>" (`ritual.py:48`). Now: "puts a Monthly update event on any calendar subscribed to the
    feed."
18. **`update-pick-month` where 'Monthly update → month ribbon' → 'Monthly update'** — "month
    ribbon" exists only in `shell.css`, and the where fence reads `.ts`/`.tsx` only, so the draft
    would have failed the fence.
19. `update-pick-month` step 2: **Start <Month>** sits in the **scope row beside the ribbon**, not
    the title row (`MonthlyUpdatePage.tsx:1314-1320`).
20. `update-balances` step 3: a rolled-up parent carries a **derived** badge (`:1500-1503`).
21. **`update-balances` step 6 was wrong**: Enter on the last cell *focuses* the primary; a second
    Enter clicks it (`AmountInput.tsx:128-133`). Now "press Enter twice from the last cell".
22. **`update-spending` step 3 was wrong**: cells do not start blank — they seed at `'0.00'`
    (`MonthlyUpdatePage.tsx:578`). What is true is that an untouched zero with no stored row is
    never sent (`sentCategories`, `:737-748`). Rewritten as "A category left at its 0.00 seed is
    skipped, not recorded as a zero."
23. `update-spending`: added the closing step **Next: review** (`:1803`).
24. **`update-review-save` step 1 was wrong**: `ReviewChanges` shows a changed-row COUNT plus two
    "largest" tables, not "every row you changed, before and after" (`ReviewChanges.tsx:49-63`).
25. **`update-review-save` step 2 was wrong**: there is no "items to review" list on the Review
    step. Replaced with the four real tiles — **Net worth**, **Living spending**, **Cash outflow**,
    **Cash saved** (`MonthlyUpdatePage.tsx:1862-1888`).
26. `update-review-save` step 5: "Settings → Data → Activity" → the bold label **Activity**, so
    the label fence holds it.
27. `update-close` step 1: the gate is spending + take-home + the three ticks + `month <= current`
    (`canRequestClose`, `:962-964`); balances alone never block. Reworded.
28. `update-close` step 2: the draft quoted all three confirmation sentences (158 chars, ~26 words)
    — replaced with "Tick the three boxes under **Confirm this month is complete** — balances,
    spending, take-home." (rule 1). The sentences themselves are on screen.
29. `update-close` step 5: the state label is **Changed since review**, not "Needs review"
    (`api/monthReview.ts:54`).
30. `update-after` steps 2-3 reworded off the two hint sentences on those cards
    (`SpendingPage.tsx:609`, `NetWorthPage.tsx:778`).
31. `update-delete-month` step 1: **Month actions** is an aria-label on an ⋯ icon button in the
    review header (`:1821-1834`) — the step now says which control to press. It renders only when
    the month was already saved.
32. `update-delete-month` step 3 reworded off the popover's own sentence, and now names what loses
    the month (rule 10).
33. **`update-phantom` where → 'Monthly update → Spending'** and **`update-conflict` where →
    'Monthly update'**: "repair banner" and "conflict banner" appear in no source text, so both
    would have failed the where fence.
34. `update-conflict` step 1: the save is *refused* (409 → `setReviewConflict`, `:950`), which the
    draft only implied.
35. `update-paste`: a keyed paste takes the **last** cell as the value (`utils/paste.ts:26,44`) and
    the blank-skip is per cell (`:1201-1207`) — steps reworded to match.
36. Card `watch` 1: "comparisons, averages and projection defaults" → "averages, comparisons and
    the month other pages open on", which is what `eligible_spending = closed or legacy_eligible`
    and `ReviewBook.default_month` actually drive
    (`backend/app/services/month_review.py:53-57,135`).
37. Card `watch` 3 (follow-up commit `c9622d3`, per G3's hand-off): the $0 consent is now named
    verbatim as **Confirm remaining categories as $0** so lane V's fence extension can hold it.
    Today it prints literal asterisks; V routes `watch` through `renderSteps`.

**Routines — tax season · keeping it healthy**

38. Step 1: "The newest year that has tables is cloned" restated `createHint`
    (`TaxesPage.tsx:810`) — rewritten as its consequence ("so every figure still needs this year's
    published number").
39. Step 2: dropped "Every year starts Single" — verbatim from the scope-row InfoHint
    (`TaxesPage.tsx:783`).
40. Step 4: **Clone from** → **Clone from <year> single tables**, the real template
    (`BracketsEditor.tsx:694`), plus the condition that the button shows only while that status tab
    is still empty (`:683`).
41. Step 5: **Add a table for** → **Add a table for <person>** (`:573`); it appears under Social
    Security and Disability only (`PER_WORKER_JURISDICTIONS`, `api/taxes.ts:34-36`).
42. Step 6: added the **derived** badge (`InputsForm.tsx:717`) and described **Apply** as filling a
    box with last year's figure (`:789-797`).
43. Step 7: added **Save limits**; **Clone from** → **Clone from <year>** (`LimitsCard.tsx:195`).
44. Step 8: linked `/taxes?section=summary` (the Will I owe? card lives on Summary,
    `TaxesPage.tsx:884-898`) and named the forms verbatim — **W-4 line 4c** and **DE 4**
    (`WithholdingPanel.tsx:441,447`).
45. `watch` 1 rewritten with a consequence clause so it is not `BracketsEditor.tsx:681`'s InfoHint
    sentence: "a married year left on the Single toggle in the scope row still computes as Single."
    `watch` 2 now names **Open Tax tables** verbatim (`SummaryPanel.tsx:303`) for V's fence.
46. **`routine-health` body: "orphaned feeds" is not a health check.** The real ones are zero-filled
    spending, spending gaps, net-pay-without-spending, stale quotes, two identical months, backup
    state and snapshot age (`backend/app/services/health_checks.py`). Listed accurately.
47. `routine-health` body: dropped "while nothing later touched the same rows" — verbatim from
    `ActivityCard.tsx:124`'s InfoHint — and replaced it with the arm-then-run behaviour
    (`ActivityCard.tsx:152`).
48. **`health-attention` step 3 was wrong**: the Needs attention card is NOT absent when empty. It
    always renders and prints "No outstanding data checks." (`OverviewPage.tsx:739,753`); only the
    inner `nav` is conditional. The stale claim comes from the comment at `:741-742`.
49. `health-about-number` step 1: since **About this number** is an accessible name on an ⓘ button,
    the step says "Press the ⓘ on the tile — its name is **About this number**."

### Deviations from the plan

- **Task 1 Step 4's predicted three hash-fence failures never happened.** The link fence walks
  `card.to` and `task.to` only (`allLinks`, `guideContent.test.ts:76-80`); `body` is unfenced by
  design ("Prose for Start here / Reference cards; may contain `<Link>`s. Not fenced." —
  `types.ts:41`). So Tasks 1-3 could be, and were, committed separately with the plan's own
  messages while every gate stayed green.
- Task 2 Step 3's completeness failure is real; `'/update'` was deleted from `PENDING_PAGES` in the
  Task 2 commit, as the plan permits.
- `start-what` was edited (purpose only) on the coordinator's instruction; the plan had it as
  "kept".
- A fourth commit was added after G3's hand-off about `watch` rendering (item 37/45).
- Fence shape re-checked on the merged content: `routine-monthly` counts as a page card
  (`to: '/update'` is a sidebar route) — 6 visible tasks, 5 `watch` lines, no `views` (Monthly
  update has no tab strip). `routine-tax-season` and `routine-health` have no `to`, so the
  page-card rules do not apply. No pointer tasks in this lane. 7 cards, 15 tasks, all ids unique
  and kebab-case, every step ≤ 160 chars.

### Hand-offs

- **V:** `start-next`'s sandbox sentence should link `/guide?section=reference#ref-sandboxes` once
  G4 lands (spec §9). Candidates for the same pass: `start-setup` 4 → `#accounts-add`,
  `start-setup` 14 → `#cards-add`, `routine-health` body → `#health-checks` / `#snapshot-now` /
  `#activity-undo` / `#portfolio-deactivate` / `#portfolio-refresh`.
- **V:** when `watch` lines start going through `renderSteps`, this lane already carries three
  `**Label**` spans in watch text (`update-monthly` trap 3, `routine-tax-season` traps 2) — all
  verified verbatim against source, so the extended fence should pass unchanged.
- **V / G5 dependency:** `start-organized` tells the reader the palette lists "every task in this
  guide". That is only true once G5 wires the Guide group (spec §6) — if G5 is cut or deferred,
  that clause must come out.
- **G5 (`OverviewPage.tsx`):** the comment at `:741-742` claims the Needs attention card is
  "Absent when nothing needs doing", which the code below it contradicts (`:753` prints "No
  outstanding data checks."). Not this lane's file; worth a comment fix where that file is already
  open.
- **G4 (Settings cards):** `accounts-owner` still owes the "Owner blank = joint" rule and
  `categories-kind` the "changing a kind recomputes all history" rule — G1 deliberately kept its
  setup checklist off those InfoHint sentences rather than pre-empting the canonical tasks.
- **Renderer:** no change needed. `ol.guide-body` renders the seventeen-item setup checklist
  acceptably as a plain ordered list; if V wants tighter list spacing that is a `GuidePage.css`
  edit in G0's files, not this lane's.
