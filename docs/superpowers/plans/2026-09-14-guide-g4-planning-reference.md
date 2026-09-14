# Lane G4 — Guide content: Planning pages + Reference (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, one card per task, the fences as the
> test, then a spec-compliance review — voice, facts, coverage — and a code-quality review,
> then a local merge to main — never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane writes the
**Pages** chapter's Projection, Calendar and two Settings cards, and the whole **Reference**
chapter (§5.1), under the writing rules in **§5.3**. Read §0, §4, §5 before Task 1. Source:
`docs/superpowers/specs/2026-09-14-onboarding-guide-research.md` §5.3 P10–P12, §5.4 F1–F7,
Appendix A.

**Goal:** the owner's asks for **forecasting projections**, **using the calendar and the
assistant**, **adding an account** and **assigning single or joint ownership**, plus the
reference material (typing, keyboard, undo, sandboxes, links, glossary, the Settings map).

**Architecture:** content only, in `src/guide/content/pages-planning.tsx`, `reference.tsx` and
a small helper `src/guide/content/settingsMap.tsx` (the *Where to configure X* table, rendered in
two cards). Lane G4 deletes `/projection`, `/calendar`, `/settings` from `PENDING_PAGES`.

**Tech stack:** TypeScript 5.9 (`strict`), React 19 JSX for `body` prose, vitest 3.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g4`, branch
  `guide/g4-planning`, cut from `main` **after G0 has merged**:
  `git worktree add -b guide/g4-planning .worktrees/guide-g4 main`; work ONLY inside it.
- Commands: `npx vitest run src/guide`, `npx tsc -b`, `npx eslint src/guide`.
- Files this lane may edit/create: `src/guide/content/pages-planning.tsx`,
  `src/guide/content/reference.tsx`, new `src/guide/content/settingsMap.tsx`,
  `src/guide/content/pending.ts` (delete `'/projection'`, `'/calendar'`, `'/settings'`). Nothing else.
- Commit after every task. Never push.

## Writing rules this plan encodes (spec §5.3)

As lane G2's list. Specific here:

1. `views`: Projection `['Planning workspace', 'Historical trend']`; Settings
   `['Household', 'Planning', 'Account', 'Integrations', 'Data']` (both Settings cards); Calendar
   has **no** tab strip (`?view=` is a toggle) — no `views` key.
2. Both Settings cards have `to: '/settings'` — the completeness fence accepts either. Each shows
   3–8 visible tasks.
3. Body prose (`<dl>`, `<table>`) is not fenced; still verify every bold there by hand.
4. Labels with apostrophes: `Today's dollars` uses a **straight** apostrophe in source — write the
   step in a double-quoted string so the bold label matches (`"Pick **Today's dollars** or …"`).
5. `Restore a snapshot` and `System status` exist as palette labels in `paletteRegistry.ts`
   (a `.ts` file — in the fence's haystack); the card eyebrows may differ — use the palette spelling
   in `where`.
6. Pointer tasks link to real destinations; no cross-lane guide anchors.

## Draft copy — paste, verify against Source, correct, run the fences, commit.

---

## Task 1 — Projection (spec §5.1 `page-projection`)

**Source:** `src/pages/ProjectionPage.tsx` — views `:27`; outcomes `:115-133`; controls `:147-160`;
selection `:78-84, 143-145`; pins `:62-75, 166-172`; warnings `:159`; historical `:178`; no-data
`:111-112`; `src/components/projection/ScenarioPanel.tsx:23-131, 141, 157-304` (knob labels,
**Use my budgets**, **Retires**, **Reset to baseline**, derived captions);
`projectionChartOptions.ts:57-78`; `src/sandbox/SandboxPanel.tsx:106-155`.

- [ ] **Step 1: Write the card**

Replace the empty array in `src/guide/content/pages-planning.tsx`:

```tsx
import type { GuideCard } from '../types'
import { SettingsMapTable } from './settingsMap'

// Chapter: Pages — Projection, Calendar, Settings ×2, sidebar order (2026-09-14 guide spec §5.1).
// Written by lane G4 from research §5.3 P10–P12; every bold label verified against source.
export const PLANNING_CARDS: GuideCard[] = [
  {
    id: 'page-projection',
    title: 'Projection',
    purpose:
      'A retirement projection from your records — investable balance, contribution, spend and withdrawal rate — with a fan of simulated paths. Nothing here is saved.',
    to: '/projection',
    views: ['Planning workspace', 'Historical trend'],
    keywords: ['projection', 'forecast', 'retire', 'fire', 'monte carlo', 'fi date'],
    tasks: [
      {
        id: 'projection-assumptions',
        title: 'Adjust an assumption',
        where: 'Projection → Planning workspace → Planning assumptions',
        steps: [
          'Type into **Annual return**, **Monthly contribution**, **Annual spend**, **Withdrawal rate**, **Horizon**, **Volatility**, **Inflation** or **Contribution growth**.',
          'Enter 5 for 5 %. Blank means derived from your records — the caption shows the derived figure.',
          'The chart and outcomes re-run as you type; the address carries the scenario.',
        ],
        to: '/projection',
        keywords: ['assumptions', 'return', 'contribution', 'forecast', 'scenario'],
      },
      {
        id: 'projection-use-budgets',
        title: 'Use your budgets as annual spend',
        where: 'Projection → Planning assumptions → Annual spend',
        steps: ['Press **Use my budgets** — twelve times the living-category budgets for the month becomes the annual spend.'],
        to: '/projection',
        keywords: ['budgets', 'annual spend'],
      },
      {
        id: 'projection-retire-month',
        title: 'Set a retirement month',
        where: 'Projection → Planning assumptions → Retires',
        steps: [
          'Type a month for each person — a dashed rule marks it on the chart.',
          'From that month, that person\u2019s take-home, payroll deductions and employer match leave the contribution stream.',
        ],
        to: '/projection',
        watch: ['Spending stays a household figure — the FI target does not move when one person retires.'],
        keywords: ['retire', 'retirement date', 'stop working'],
      },
      {
        id: 'projection-dollars',
        title: 'Switch between today\u2019s and future dollars',
        where: 'Projection → chart controls',
        steps: ["Pick **Today's dollars** or **Future dollars** — display only; dates, probabilities and targets do not move."],
        to: '/projection',
        keywords: ['inflation', 'nominal', 'real dollars'],
      },
      {
        id: 'projection-pin',
        title: 'Pin and compare scenarios',
        where: 'Projection → Compare your scenarios',
        steps: [
          'Type a label and press **Pin this scenario** — up to three, kept in this browser.',
          'Pinned runs draw as extra lines and columns; **Copy link** shares the live scenario.',
        ],
        to: '/projection',
        keywords: ['pin', 'compare', 'share scenario'],
      },
      {
        id: 'projection-reset',
        title: 'Reset to the derived baseline',
        where: 'Projection → Planning assumptions',
        steps: ['Press **Reset to baseline** — every knob returns to what the records imply.'],
        to: '/projection',
      },
    ],
    more: [
      {
        id: 'projection-window',
        title: 'Change the chart window and axis',
        where: 'Projection → chart controls',
        steps: ['**Next milestone** or **Full horizon**; **Linear** or **Log** — the log axis omits values at or below zero.'],
        to: '/projection',
      },
      {
        id: 'projection-historical',
        title: 'Read the historical trend',
        where: 'Projection → Historical trend',
        steps: ['Loaded when the tab is first opened; span chips widen it. Under three snapshots it draws dots and says why.'],
        to: '/projection?section=trend',
      },
      {
        id: 'projection-outcomes',
        title: 'Read the outcomes band',
        where: 'Projection → Planning workspace',
        steps: [
          'FI target (annual spend ÷ withdrawal rate), FI ratio, investable balance (cash and liabilities excluded), projected FI date, and the share of simulated paths reaching FI within the horizon.',
        ],
        to: '/projection',
      },
    ],
    watch: [
      'Nothing on this page is saved — the stored withdrawal rate lives under Settings → Planning → Plan assumptions.',
      'The probability tile is "reach FI within the horizon", not spending sustainability.',
      'RSU vests are not in the derived contribution — raise it to model them.',
      'Volatility 0 turns the fan off; it is a legitimate value.',
    ],
  },
]
```

The `SettingsMapTable` import is used by Task 3; create `settingsMap.tsx` in Task 3 before the
type-check of this task, or add the import then.

- [ ] **Step 2: Verify** — knob labels (`ScenarioPanel.tsx:28-99`), `Use my budgets`, `Retires`,
`Reset to baseline`, `Compare your scenarios`, `Today's dollars`/`Future dollars`,
`Next milestone`/`Full horizon`, `Linear`/`Log` (`ProjectionPage.tsx:147-160`); the 500-path
probability wording; cash and liabilities excluded from investable (`:115-133`).

- [ ] **Step 3: Fences**; delete `'/projection'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-planning.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Projection (spec §5.1)"
```

---

## Task 2 — Calendar (spec §5.1 `page-calendar`)

**Source:** `src/pages/CalendarPage.tsx` — window `:48-57, 162-186`; navigation `:213-245, 593-620`;
view toggle `:95, 255-260, 561-563`; day drawer `:296-305`; popover `:264-294`; add form `:334-343,
390-404, 436-470` + `src/components/calendar/AddEventForm.tsx:54-144`; edit `:312-332, 406-426`;
delete + Undo `:472-503`; hide + Undo `:506-529`; **Add to calendar (.ics)** `:574-588`;
`EventDetails.tsx:19-27, 48-54, 106-110, 126-202` (**Mark done**/**Reopen**, **Hide**/**Unhide**,
**Your figure**, **Save figure**, **Use the estimate**); `src/components/settings/CalendarFeedCard.tsx:24-290`
(**New feed link**, **Copy**, **Done**, **Revoke**, **Monthly update reminder day**, **Save reminder day**);
`backend/app/api/calendar.py:205-251, 440-481, 734-802`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-calendar',
    title: 'Calendar',
    purpose:
      'Every dated thing the household\u2019s money touches — vests, paydays, ESPP dates, ex-dividends, tax deadlines, card dates, the monthly reminder and your own events — computed on read, never stored twice.',
    to: '/calendar',
    keywords: ['calendar', 'events', 'deadline', 'payday', 'ics', 'reminder'],
    tasks: [
      {
        id: 'calendar-navigate',
        title: 'Move around the calendar',
        where: 'Calendar',
        steps: [
          'Use the arrows, **Today** or **Jump to month**; arrow keys move the cursor in the grid, PageUp and PageDown change month.',
          'Switch grid and list with the view toggle — the list shows the visible month, hidden events dimmed.',
        ],
        to: '/calendar',
        keywords: ['navigate', 'list view', 'grid'],
      },
      {
        id: 'calendar-add-event',
        title: 'Add your own event',
        where: 'Calendar → Add event',
        steps: [
          'Press **Add event**; fill the date, label, an optional note, the person, an optional amount with its direction, and how it repeats.',
          'Press **Save** — the grid lands on that date.',
        ],
        to: '/calendar?add=1',
        watch: ['Without an amount the direction is forced to neutral — money out of nothing is not a fact.'],
        keywords: ['custom event', 'reminder', 'add event', 'new event'],
      },
      {
        id: 'calendar-edit-event',
        title: 'Edit or delete your event',
        where: 'Calendar → event popover',
        steps: [
          'Click the chip, press **Edit**, change it, **Save**.',
          '**Delete** offers **Undo** in the toast; a repeating series is edited and restored from its start.',
        ],
        to: '/calendar',
      },
      {
        id: 'calendar-override',
        title: 'Mark a generated event done, hide it, or enter your figure',
        where: 'Calendar → event popover',
        steps: [
          '**Mark done** or **Reopen** a deadline.',
          '**Hide** removes it from the grid; **Unhide** from the list view brings it back.',
          'Under **Your figure**, type what you paid and press **Save figure**; **Use the estimate** clears it.',
        ],
        to: '/calendar',
        keywords: ['done', 'hide event', 'your figure', 'override'],
      },
      {
        id: 'calendar-export-ics',
        title: 'Download the visible months as .ics',
        where: 'Calendar → Add to calendar (.ics)',
        steps: ['Press **Add to calendar (.ics)** — the server composes the visible window with your overrides and alarms.'],
        to: '/calendar',
        keywords: ['ics', 'download calendar', 'export'],
      },
      {
        id: 'calendar-subscribe',
        title: 'Subscribe a phone or desktop calendar',
        where: 'Settings → Integrations → Calendar feed',
        steps: [
          'Type a label for the device and press **New feed link**.',
          'Press **Copy** — the address is shown once — then **Done**.',
          'Google: Other calendars → From URL. Apple: File → New Calendar Subscription.',
          'Press **Revoke** on a link when a device is gone.',
        ],
        to: '/settings?section=integrations#calendar',
        watch: ['The link is the credential — anyone holding it can read the feed, amounts included.'],
        keywords: ['subscribe', 'feed', 'phone calendar', 'google calendar', 'apple calendar', 'ical'],
      },
      {
        id: 'calendar-reminder-day',
        title: 'Set the monthly update reminder day',
        where: 'Settings → Integrations → Calendar feed → Monthly update reminder day',
        steps: ['Type a day from 1 to 28 and press **Save reminder day** — the reminder lands on that day each month with an alarm three days before.'],
        to: '/settings?section=integrations#calendar',
        keywords: ['reminder', 'monthly reminder', 'reminder day'],
      },
    ],
    more: [
      {
        id: 'calendar-open-day',
        title: 'Open a day',
        where: 'Calendar → grid',
        steps: ['Click the day number, or the more chip when a day is full; Escape returns to the cell.'],
        to: '/calendar',
      },
      {
        id: 'calendar-follow',
        title: 'Follow an event to its page',
        where: 'Calendar → event popover',
        steps: ['The popover\u2019s open link lands on the page that owns the event — a card, a grant, a tax deadline.'],
        to: '/calendar',
      },
      {
        id: 'calendar-source-health',
        title: 'Read what the calendar could not see',
        where: 'Calendar → footer',
        steps: ['The footer names each generator and its reason — cards without an opened date, no purchase periods stored.'],
        to: '/calendar',
      },
    ],
    watch: [
      'The subscription link is a credential — revoke it when a device is gone.',
      'Done, hide and your figure apply to generated events; your own events are edited directly.',
      'A repeating series is identified by its start date — editing an occurrence edits the series.',
    ],
  },
```

- [ ] **Step 2: Verify** — `Today`, `Jump to month`, `Add event`, `Save`, `Edit`, `Delete`,
`Undo`, `Mark done`, `Reopen`, `Hide`, `Unhide`, `Your figure`, `Save figure`, `Use the estimate`,
`Add to calendar (.ics)`, `New feed link`, `Copy`, `Done`, `Revoke`, `Save reminder day`,
`Monthly update reminder day`; the 1–28 rule and three-day alarm (`CalendarFeedCard.tsx:19-20, 105-129`);
the neutral-direction rule (`AddEventForm.tsx`).

- [ ] **Step 3: Fences**; delete `'/calendar'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-planning.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Calendar (spec §5.1)"
```

---

## Task 3 — the Settings map helper and the two Settings cards (spec §5.1)

**Source:** `src/pages/SettingsPage.tsx:34, 185-263, 315-442` (password, import);
`src/components/settings/HouseholdCard.tsx:68-125` (**Add member**, **Rename**, **Save name**,
**Marriage date**, **Save marriage date**); `AccountsCard.tsx:38-45, 119-126, 161-275, 293-385,
469-539` (**Account name**, **Group**, **Owner**, **Sort order**, **Parent account**, **Component
of the parent**, **Add account**, **Save account**, **Retire**, **Restore**, **Delete**, **Roll-up**,
portfolio-account **Owner for**); `CategoriesCard.tsx:28-32, 116-226` (**Category name**,
**Add category**, **Living**/**Tax**/**Transfer**); `LimitsCard.tsx:136-205` (**Save limits**,
**Clone from <year>**); `PlanAssumptionsCard.tsx:166-250`; `AppearanceCard.tsx:15-100`;
`PriceRefreshCard.tsx:100-200` (**Price refresh cron**, **Save schedule**, **Refresh now**);
`AssistantCard.tsx:130-235` (**NVIDIA API key**, **Default model**, **Save assistant settings**,
**Test key**, **Remove saved key**); `BackupsCard.tsx:60-113` (**Snapshot now**, **Download snapshot
(.zip)**); `RestoreCard.tsx:203-292` (**Dry run**, **Restore**); `HealthCard.tsx:20-135`;
`ActivityCard.tsx:100-200` (**Undo**, **View report**, **Load more**); `SystemCard.tsx:20-140`;
`backend/app/api/net_worth.py:55-91, 151-226`, `spending.py:157-175`.

- [ ] **Step 1: Create the shared table**

`src/guide/content/settingsMap.tsx`:

```tsx
import { Link } from 'react-router-dom'

// "Where to configure X" — rendered inside the second Settings card and again in Reference
// (2026-09-14 guide spec §5.1). One constant, two placements; every link is a real Settings
// card anchor and is fenced through the cards that use it.
const ROWS: { task: string; to: string; place: string }[] = [
  { task: 'Add a person, rename, set the marriage date', to: '/settings?section=household#household', place: 'Household → Household' },
  { task: 'Add, own, retire or delete a net-worth account; link parent and component; re-tag a portfolio account\u2019s owner', to: '/settings?section=household#accounts', place: 'Household → Accounts' },
  { task: 'Add spending categories; set Living, Tax or Transfer', to: '/settings?section=household#categories', place: 'Household → Spending categories' },
  { task: 'Enter or clone this year\u2019s contribution limits', to: '/settings?section=planning#limits', place: 'Planning → Contribution limits' },
  { task: 'Withdrawal rate, ESPP ticker and discount', to: '/settings?section=planning#plan-assumptions', place: 'Planning → Plan assumptions' },
  { task: 'Theme, density, chart patterns, landing page', to: '/settings?section=account#appearance', place: 'Account → Appearance' },
  { task: 'Change the password (signs out other devices)', to: '/settings?section=account#password', place: 'Account → Password' },
  { task: 'Price refresh schedule and Refresh now', to: '/settings?section=integrations#price-refresh', place: 'Integrations → Price refresh' },
  { task: 'Assistant key, default model, Test key', to: '/settings?section=integrations#assistant', place: 'Integrations → Assistant' },
  { task: 'Calendar feed links and the monthly reminder day', to: '/settings?section=integrations#calendar', place: 'Integrations → Calendar feed' },
  { task: 'Import the workbook (dry run, then apply)', to: '/settings?section=data#import', place: 'Data → Import workbook' },
  { task: 'Snapshot now, download the ZIP, the nightly schedule', to: '/settings?section=data#backups', place: 'Data → Backups & snapshots' },
  { task: 'Restore a snapshot (dry run, type the date, restore)', to: '/settings?section=data#restore', place: 'Data → Restore' },
  { task: 'Health checks with inline fixes', to: '/settings?section=data#health', place: 'Data → Data health' },
  { task: 'Data-through clauses, backups, schema, environment', to: '/settings?section=data#system', place: 'Data → System status' },
  { task: 'Change log with durable Undo; import and restore reports', to: '/settings?section=data#activity', place: 'Data → Activity' },
]

export function SettingsMapTable() {
  return (
    <table className="data-table guide-map">
      <thead>
        <tr>
          <th>To…</th>
          <th>Go to</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.to}>
            <td>{row.task}</td>
            <td>
              <Link to={row.to}>{row.place}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

(`.data-table` is the house table class in `panels.css`; if `guide-map` needs a rule — a
`max-width` or cell padding — report it for V rather than editing `GuidePage.css`.)

- [ ] **Step 2: Append the two Settings cards**

```tsx
  {
    id: 'page-settings',
    title: 'Settings — Household & Planning',
    purpose:
      'Who the dashboard tracks and what they own — people, accounts, categories — plus the year\u2019s limits and planning assumptions.',
    to: '/settings',
    views: ['Household', 'Planning', 'Account', 'Integrations', 'Data'],
    keywords: ['settings', 'household', 'accounts', 'categories', 'limits', 'people'],
    tasks: [
      {
        id: 'household-add-member',
        title: 'Add a household member',
        where: 'Settings → Household → Household',
        steps: [
          'Type the name and press **Add member**.',
          'The person is selectable at once as an owner on accounts, portfolio accounts, paycheck profiles and cards.',
        ],
        to: '/settings?section=household#household',
        keywords: ['partner', 'spouse', 'add person', 'household member'],
      },
      {
        id: 'accounts-add',
        title: 'Add an account',
        where: 'Settings → Household → Accounts',
        steps: [
          'Type the **Account name**; pick the **Group** — Cash, Pre-tax, Post-tax, Taxable, Equity, Other or Liabilities.',
          'Pick the **Owner**, or leave it blank for joint; set the **Sort order**.',
          'Press **Add account** — it appears in the monthly wizard and the net-worth charts.',
        ],
        to: '/settings?section=household#accounts',
        watch: ['Liability accounts hold negative balances in the wizard.'],
        keywords: ['add account', 'new account', 'bank account', 'brokerage account', '401k account'],
      },
      {
        id: 'accounts-owner',
        title: 'Assign single or joint ownership',
        where: 'Settings → Household → Accounts',
        steps: [
          '**Owner** blank means joint — the account counts for the household and in each person\u2019s Joint view.',
          'Pick a person to make it theirs; the Whose chips on Net worth, Portfolio and Overview follow the choice.',
          'Portfolio accounts have their own owner table under the roster — a label typed on a transaction belongs to the primary person until re-tagged here.',
        ],
        to: '/settings?section=household#accounts',
        keywords: ['joint', 'ownership', 'owner', 'whose account', 'single owner'],
      },
      {
        id: 'accounts-parent-component',
        title: 'Link component accounts to a parent',
        where: 'Settings → Household → Accounts',
        steps: [
          'On the component, pick the **Parent account** and tick **Component of the parent** — both halves together.',
          'In the wizard you type into components; the parent derives and is read-only.',
        ],
        to: '/settings?section=household#accounts',
        watch: ['A component whose parent is retired counts nowhere — the Roll-up column turns amber.'],
        keywords: ['component', 'parent account', 'derived'],
      },
      {
        id: 'categories-add',
        title: 'Add a spending category',
        where: 'Settings → Household → Spending categories',
        steps: [
          'Type the **Category name** and a **Sort order**; press **Add category**.',
          'Per row, **Edit**, **Retire** or **Delete** — delete works only while a category has no monthly rows.',
        ],
        to: '/settings?section=household#categories',
        keywords: ['category', 'new category', 'spending category'],
      },
      {
        id: 'categories-kind',
        title: 'Set a category\u2019s kind',
        where: 'Settings → Household → Spending categories',
        steps: [
          'Pick **Living**, **Tax** or **Transfer** on the row.',
          'Living is lifestyle spend; Tax is an income-tax payment from take-home; Transfer is money moved to your own accounts.',
        ],
        to: '/settings?section=household#categories',
        watch: ['Changing a kind recomputes every month, chart and projection — set kinds before entering history.'],
        keywords: ['living', 'transfer', 'tax category', 'kind'],
      },
      {
        id: 'limits-enter',
        title: 'Enter contribution limits',
        where: 'Settings → Planning → Contribution limits',
        steps: [
          'Pick the year chip; type each limit; press **Save limits** — or **Clone from** last year.',
          'Blank means not entered; the Paycheck pace meters and the sandbox presets need these.',
        ],
        to: '/settings?section=planning#limits',
        keywords: ['limits', '401k limit', 'hsa limit', 'irs limits', 'contribution limit'],
      },
      {
        id: 'plan-assumptions',
        title: 'Set plan assumptions',
        where: 'Settings → Planning → Plan assumptions',
        steps: [
          'Type **Withdrawal rate (% / year)**, **ESPP ticker** and **ESPP discount (%)**; press **Save assumptions**.',
          'They feed Projection, ESPP and Paycheck.',
        ],
        to: '/settings?section=planning#plan-assumptions',
        keywords: ['withdrawal rate', 'swr', 'espp ticker', 'plan assumptions'],
      },
    ],
    more: [
      {
        id: 'household-marriage-date',
        title: 'Set the marriage date',
        where: 'Settings → Household → Household',
        steps: [
          'Type the **Marriage date** and press **Save marriage date** — it drives married filing and marks the net-worth trend.',
          'Nothing is backfilled — a partner\u2019s accounts and balances start when you enter them.',
        ],
        to: '/settings?section=household#household',
        keywords: ['marriage', 'married', 'wedding'],
      },
      {
        id: 'accounts-retire-delete',
        title: 'Retire or delete an account',
        where: 'Settings → Household → Accounts',
        steps: [
          '**Retire** keeps history and removes the account from the wizard and charts; **Restore** brings it back.',
          '**Delete** works only while an account has no balances — otherwise retire it.',
        ],
        to: '/settings?section=household#accounts',
        keywords: ['retire account', 'delete account', 'close account'],
      },
      {
        id: 'household-rename',
        title: 'Rename a person',
        where: 'Settings → Household → Household',
        steps: ['Press **Rename**, type the name, press **Save name** — the primary member can be renamed but never removed.'],
        to: '/settings?section=household#household',
      },
    ],
    watch: [
      'Delete is refused for accounts with balances and categories with rows — retire instead.',
      'A category kind change recomputes all history.',
      'The primary member can be renamed but never changed or removed.',
    ],
  },
  {
    id: 'page-settings-data',
    title: 'Settings — Account, Integrations & Data',
    purpose:
      'Your account and appearance, the integrations — prices, assistant, calendar feed — and the data lifecycle: import, snapshots, restore, health, activity.',
    to: '/settings',
    views: ['Household', 'Planning', 'Account', 'Integrations', 'Data'],
    keywords: ['settings', 'backup', 'restore', 'import', 'api key', 'theme', 'password'],
    tasks: [
      {
        id: 'appearance',
        title: 'Change theme, density and landing page',
        where: 'Settings → Account → Appearance',
        steps: [
          'Pick a theme (System follows the OS), a density, chart patterns and the landing page.',
          'Painted in this browser first, then synced to your account at sign-in.',
        ],
        to: '/settings?section=account#appearance',
        keywords: ['theme', 'dark mode', 'light mode', 'density', 'landing page', 'appearance'],
      },
      {
        id: 'password',
        title: 'Change the password',
        where: 'Settings → Account → Password',
        steps: [
          'Type the current password and the new one twice; press **Change password**.',
          'Every other device is signed out; this one stays in.',
        ],
        to: '/settings?section=account#password',
        keywords: ['password', 'sign out devices'],
      },
      {
        id: 'price-refresh-schedule',
        title: 'Set the price refresh schedule',
        where: 'Settings → Integrations → Price refresh',
        steps: [
          'Type a five-field cron in **Price refresh cron** using day names, and press **Save schedule** — it applies at once.',
          'Press **Refresh now** for an immediate run.',
        ],
        to: '/settings?section=integrations#price-refresh',
        watch: ['Keep Mondays in the schedule — the Monday run records the weekly performance point; runs more often than hourly are refused.'],
        keywords: ['cron', 'schedule', 'price refresh', 'scheduler'],
      },
      {
        id: 'assistant-key',
        title: 'Set up the assistant',
        where: 'Settings → Integrations → Assistant',
        steps: [
          'Paste the key into **NVIDIA API key**, pick a **Default model**, press **Save assistant settings**.',
          'Press **Test key** to probe the models; **Remove saved key** falls back to the server\u2019s .env.',
        ],
        to: '/settings?section=integrations#assistant',
        watch: ['Asking the assistant sends the relevant figures from your dashboard to the provider under this key.'],
        keywords: ['api key', 'assistant setup', 'nvidia', 'model'],
      },
      {
        id: 'import-workbook',
        title: 'Import the workbook',
        where: 'Settings → Data → Import workbook',
        steps: [
          'Choose the .xlsx, press **Dry run**, read the per-sheet diff.',
          'Press **Apply import** and confirm — sheet values overwrite imported rows, including UI edits in sheet-covered tax years.',
          'If you re-saved the file after choosing it, pick it again.',
        ],
        to: '/settings?section=data#import',
        keywords: ['import', 'xlsx', 'spreadsheet', 'workbook', 'migrate'],
      },
      {
        id: 'snapshot-now',
        title: 'Write and download a snapshot',
        where: 'Settings → Data → Backups & snapshots',
        steps: [
          'Press **Snapshot now** for an immediate export ZIP on the server; nightly at 23:30 PT the app writes one and keeps the newest fourteen.',
          'Press **Download snapshot (.zip)** to keep a copy.',
        ],
        to: '/settings?section=data#backups',
        keywords: ['backup', 'snapshot', 'export', 'download data'],
      },
      {
        id: 'restore-snapshot',
        title: 'Restore a snapshot',
        where: 'Settings → Data → Restore a snapshot',
        steps: [
          'Pick a file or a stored snapshot; press **Dry run** and read the report.',
          'Type the snapshot\u2019s date to arm, then press **Restore** — a pre-restore point is written first.',
        ],
        to: '/settings?section=data#restore',
        keywords: ['restore', 'recover', 'rollback'],
      },
      {
        id: 'activity-undo',
        title: 'Undo a change from the log',
        where: 'Settings → Data → Activity',
        steps: [
          'Find the change — newest first — and press **Undo** twice: once to arm, once to fire.',
          'Undo works while nothing later touched the same rows; imports and restores are undone by restoring a snapshot instead.',
        ],
        to: '/settings?section=data#activity',
        keywords: ['undo', 'activity log', 'revert', 'change log'],
      },
    ],
    more: [
      {
        id: 'health-checks',
        title: 'Fix a data-health problem',
        where: 'Settings → Data → Data health',
        steps: ['Each failing check carries its fix — a link, a **Delete** for a zero-filled month (press to arm, again to confirm), or **Snapshot now**.'],
        to: '/settings?section=data#health',
        keywords: ['health', 'zero month', 'checks', 'data health'],
      },
      {
        id: 'calendar-feed-pointer',
        title: 'Create a calendar subscription link',
        where: 'Settings → Integrations → Calendar feed',
        steps: ['Feed links are minted, copied once and revoked under Settings → Integrations → **Calendar feed** — see the Calendar card in this guide.'],
        to: '/settings?section=integrations#calendar',
      },
      {
        id: 'calendar-reminder-pointer',
        title: 'Set the monthly reminder day',
        where: 'Settings → Integrations → Calendar feed',
        steps: ['The reminder day lives on the same **Calendar feed** card — see the Calendar card in this guide.'],
        to: '/settings?section=integrations#calendar',
      },
      {
        id: 'system-status',
        title: 'Read system status',
        where: 'Settings → Data → System status',
        steps: ['Data-through clauses, the last backup, recent backups, database size, schema head and environment — read-only.'],
        to: '/settings?section=data#system',
      },
    ],
    body: <SettingsMapTable />,
    watch: [
      'A failed import apply may have partially written — restore the snapshot you took first.',
      'The cron uses day names (mon-fri); numeric days slip by one.',
      'The assistant key saved here overrides the server\u2019s .env key.',
    ],
  },
]
```

- [ ] **Step 3: Verify** — every bold label against the Source lines (in particular `Component of
the parent`, `Parent account`, `Roll-up`, `Withdrawal rate (% / year)`, `ESPP discount (%)`,
`Price refresh cron`, `Save schedule`, `Save assistant settings`, `Remove saved key`,
`Download snapshot (.zip)`, `Change password`, `Save limits`); `where` segments `Household`,
`Accounts`, `Spending categories`, `Contribution limits`, `Plan assumptions`, `Appearance`,
`Password`, `Price refresh`, `Assistant`, `Import workbook`, `Backups & snapshots`,
`Restore a snapshot`, `Data health`, `Activity`, `System status` exist (card titles or the palette
labels in `paletteRegistry.ts`); the two-click arm on Activity Undo and Health Delete; the
23:30 PT / fourteen-kept facts (`BackupsCard.tsx:60-96`); the hourly floor on the cron.

- [ ] **Step 4: Fences**; delete `'/settings'` from `PENDING_PAGES`. Expected: the "two Settings
cards" both carry `to: '/settings'` — the completeness fence is satisfied by either; the
uniqueness fence is satisfied because their ids differ.

- [ ] **Step 5: Commit**

```bash
git add src/guide/content/settingsMap.tsx src/guide/content/pages-planning.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Settings (Household & Planning; Account, Integrations & Data) with the Settings map (spec §5.1)"
```

---

## Task 4 — Reference chapter (spec §5.1)

**Source:** `docs/superpowers/specs/2026-08-21-data-entry-ergonomics-design.md` + `src/components/AmountInput.tsx:11-179`,
`src/utils/amount.ts`, `src/utils/paste.ts:28-70` (typing rules); `src/components/CommandPalette.tsx:174-191`
(Ctrl/⌘+K), `src/components/shell/LocalSections.tsx:139-147` (← → Home End), `src/pages/CalendarPage.tsx:213-245`
(grid keys), `src/components/Layout.tsx:175-177` (skip link), `InfoHint.tsx:79-102` (Escape);
`src/components/ToastProvider.tsx:41, 70-74, 212-214`; `ActivityCard.tsx:124`; `RestoreCard.tsx:203-292`;
`MonthlyUpdatePage.tsx:1838-1850`; `README.md:843-866` + `src/sandbox/*` (sandboxes);
`src/components/shell/useScope.ts` (`?month`, `?owner`, `?range`); `LocalSections.tsx:31` (`?section`);
`src/components/assistant/AssistantDrawer.tsx:200-400, 683-930`, `samples.ts:1-60`,
`paletteRegistry.ts` (**Ask assistant**), `AssistantCard.tsx:24-180`; glossary terms: `src/utils/metricReceipt.ts`
(`COMPLETENESS_LABELS`), `src/api/monthReview.ts` (`REVIEW_LABELS`), `docs/reviews/2026-09-12-dashboard-experience-review.md`
(Living spending, Tax paid from take-home, Transfers, Cash outflow).

- [ ] **Step 1: Write the chapter**

Replace the empty array in `src/guide/content/reference.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'
import { SettingsMapTable } from './settingsMap'

// Chapter: Reference (2026-09-14 guide spec §5.1). Written by lane G4 from research §5.4.
export const REFERENCE_CARDS: GuideCard[] = [
  {
    id: 'ref-typing',
    title: 'Typing numbers and moving between cells',
    purpose: 'Every money box accepts what a spreadsheet would, evaluates simple arithmetic, and commits on Enter or blur.',
    keywords: ['typing', 'number format', 'arithmetic', 'paste'],
    tasks: [
      {
        id: 'typing-formats',
        title: 'Type a number the way you have it',
        where: 'Any money box',
        steps: [
          'Accepted: a dollar sign, commas, a leading plus or minus, and accounting negatives in parentheses.',
          'Rejected: exponent notation and a second decimal point — the box turns invalid and names the problem.',
          'Blank means not entered, never zero.',
        ],
        keywords: ['dollar sign', 'commas', 'negative', 'format'],
      },
      {
        id: 'typing-arithmetic',
        title: 'Add up inside a box',
        where: 'Any money box',
        steps: [
          'Start with an equals sign: =1200+34.56 commits 1234.56 on Enter or when you leave the box.',
          'Money boxes only — shares, prices, percents and dates take plain numbers.',
        ],
        keywords: ['formula', 'sum', 'equals'],
      },
      {
        id: 'typing-move',
        title: 'Move between cells',
        where: 'Any entry form',
        steps: [
          'Focus selects the whole value — type to replace it.',
          'Enter commits and moves down; Shift+Enter moves up; the up and down arrows do the same.',
          'Enter on the last cell focuses the form\u2019s primary button, so Enter twice finishes the step.',
          'Escape puts back the value the box had when you arrived.',
        ],
        keywords: ['enter key', 'next cell', 'keyboard entry'],
      },
      {
        id: 'typing-paste',
        title: 'Paste from a spreadsheet',
        where: 'Any entry form',
        steps: [
          'One column pasted into a cell fills downward in table order; a name-and-value block fills by name.',
          'Empty cells are skipped, not blanked; a status line says how many values landed and which names did not match.',
        ],
        keywords: ['paste', 'clipboard', 'spreadsheet'],
      },
    ],
  },
  {
    id: 'ref-keyboard',
    title: 'Keyboard shortcuts',
    purpose: 'Few and consistent: one for the palette, two to save, Escape to back out, arrows inside grids and tab strips.',
    keywords: ['keyboard', 'shortcuts', 'hotkeys'],
    tasks: [
      {
        id: 'keys-palette',
        title: 'Open the command palette',
        where: 'Any page',
        steps: ['Ctrl+K (⌘K on a Mac). Up and down move, Enter runs, Escape closes.'],
        keywords: ['ctrl k', 'command palette', 'search'],
      },
      {
        id: 'keys-save',
        title: 'Save from any cell',
        where: 'Any entry form',
        steps: ['Ctrl+Enter or Ctrl+S presses the form\u2019s primary button — the browser\u2019s save dialog never opens.'],
        keywords: ['ctrl enter', 'ctrl s', 'save shortcut'],
      },
      {
        id: 'keys-escape',
        title: 'Back out',
        where: 'Any page',
        steps: ['Escape closes the palette, a hint bubble, a popover, a day drawer and the assistant — one level at a time.'],
      },
      {
        id: 'keys-tabs',
        title: 'Move between a page\u2019s views',
        where: 'Any tab strip',
        steps: ['With a tab focused, left and right arrows move, Home and End jump to the ends; the address updates without adding history.'],
      },
      {
        id: 'keys-calendar',
        title: 'Move in the calendar grid',
        where: 'Calendar',
        steps: ['Arrows move a day at a time, PageUp and PageDown a month; Enter opens the day.'],
        to: '/calendar',
      },
      {
        id: 'keys-skip',
        title: 'Skip the sidebar',
        where: 'Any page',
        steps: ['Tab once from the very top and press Enter on **Skip to content**.'],
      },
    ],
  },
  {
    id: 'ref-undo',
    title: 'Undo, snapshots, and what cannot be undone',
    purpose: 'Three layers: the toast, the Activity log, and snapshots — and a short list of things none of them reverses.',
    keywords: ['undo', 'safety', 'backup', 'restore'],
    tasks: [],
    body: (
      <ul className="guide-body">
        <li>
          <b>The toast.</b> Most saves and deletes show one for six seconds with <b className="guide-label">Undo</b>; it
          pauses while your pointer or focus is on it.
        </li>
        <li>
          <b>The Activity log.</b> <Link to="/settings?section=data#activity">Settings → Data → Activity</Link> lists
          every money-bearing change, newest first, with <b className="guide-label">Undo</b> — press once to arm, again to
          fire — while nothing later touched the same rows.
        </li>
        <li>
          <b>Snapshots.</b> Written nightly at 23:30 PT, the newest fourteen kept;{' '}
          <b className="guide-label">Snapshot now</b> before an import or a big edit. A{' '}
          <Link to="/settings?section=data#restore">restore</Link> writes a pre-restore point first, so stepping back is
          one more restore.
        </li>
        <li>
          <b>Typed confirmations.</b> Deleting a month asks for the month as YYYY-MM; restoring asks for the snapshot\u2019s
          date.
        </li>
        <li>
          <b>Never undone.</b> A revoked calendar feed link; a card\u2019s matrix multipliers after a card Undo; the sign-outs
          a password change causes. Imports and restores are undone only by restoring a snapshot.
        </li>
      </ul>
    ),
  },
  {
    id: 'ref-sandboxes',
    title: 'Trying things without saving',
    purpose: 'Three sandboxes answer what-if questions from live data; the address bar is the scenario, and nothing writes.',
    keywords: ['sandbox', 'what if', 'scenario', 'try changes'],
    tasks: [],
    body: (
      <ul className="guide-body">
        <li>
          <Link to="/paycheck?section=changes">Paycheck → Try changes</Link>, <Link to="/taxes?section=whatif">Taxes → What-if</Link>{' '}
          and <Link to="/projection">Projection</Link>\u2019s assumptions.
        </li>
        <li>
          The scenario lives in the address (<code>whatif=</code> entries), so <b className="guide-label">Copy link</b>{' '}
          shares it and Back leaves the page rather than replaying slider moves.
        </li>
        <li>
          <b className="guide-label">Pin this scenario</b> keeps up to three per page in this browser — knobs only, re-run
          on live data at every visit, never part of a link.
        </li>
        <li>
          <b className="guide-label">Reset to actual</b> or <b className="guide-label">Reset to baseline</b> clears the
          scenario.
        </li>
        <li>
          Nothing in a sandbox writes. The only doors out are explicit: Paycheck pre-fills the profile form and you press
          its own <b className="guide-label">Add profile</b>; Taxes writes overrides after a before-and-after confirm;
          Projection has no apply at all.
        </li>
      </ul>
    ),
  },
  {
    id: 'ref-links',
    title: 'Every view has a link',
    purpose: 'The address carries the view, the month, whose figures, the window and any scenario — copy it to share exactly what you see.',
    keywords: ['link', 'url', 'share', 'deep link'],
    tasks: [],
    body: (
      <ul className="guide-body">
        <li>
          <code>?section=</code> — the view on a tabbed page; <code>?month=YYYY-MM</code> — the month on pages with a ribbon.
        </li>
        <li>
          <code>?owner=</code> — whose figures (all, joint or a person); <code>?range=</code> — the window (all, 1y, ytd).
          Owner and window are remembered across pages; the month is not.
        </li>
        <li>
          <code>#card</code> on Settings opens the tab and rings the card; <code>whatif=</code> carries a sandbox scenario.
        </li>
        <li>Back and Forward restore the view, the period, the owner and the selection.</li>
      </ul>
    ),
  },
  {
    id: 'ref-assistant',
    title: 'Asking the assistant',
    purpose: 'An analyst grounded in your own figures: it answers from the page you are on and the tools it is given, cites what it used, and links back.',
    keywords: ['assistant', 'ai', 'chat', 'ask'],
    tasks: [
      {
        id: 'assistant-open',
        title: 'Open the assistant',
        where: 'Any page → ✦',
        steps: [
          'Press the ✦ button at the bottom right, or run **Ask assistant** from the command palette.',
          'It opens beside the work where there is room; Escape closes it and returns focus.',
        ],
        keywords: ['open assistant', 'chat', 'ai'],
      },
      {
        id: 'assistant-ask',
        title: 'Ask a question about what you see',
        where: 'Assistant → composer',
        steps: [
          'Type the question and press **Ask the assistant** — it sees the page and view you are on, and the month, owner or year selected.',
          'Answers cite figures; click a cited figure to open its receipt, and follow a link back to the page.',
        ],
        keywords: ['ask', 'question', 'explain', 'why did'],
      },
      {
        id: 'assistant-presets',
        title: 'Use a preset',
        where: 'Assistant → chips',
        steps: [
          '**Month in review**, **What changed in my spending?** and **Contribution-limit pace** compute a summary first, then the narrative.',
          'Some pages add starters of their own.',
        ],
        keywords: ['preset', 'month in review'],
      },
      {
        id: 'assistant-key-pointer',
        title: 'Set up the key',
        where: 'Settings → Integrations → Assistant',
        steps: ['The key and the default model live under Settings → Integrations → **Assistant** — see the Settings card in this guide.'],
        to: '/settings?section=integrations#assistant',
      },
    ],
    watch: [
      'Asking sends the relevant figures from your dashboard to the provider under your key.',
      'The assistant answers only from your data and its tools — it will say when the data does not hold the answer.',
    ],
  },
  {
    id: 'ref-glossary',
    title: 'Words this dashboard uses',
    purpose: 'The terms that appear on tiles, receipts and badges, in one place.',
    keywords: ['glossary', 'definitions', 'terms', 'what does mean'],
    tasks: [],
    body: (
      <dl className="guide-body guide-glossary">
        <dt>Living spending</dt>
        <dd>Spend in categories of kind Living — the lifestyle figure the budget meters and savings rate use.</dd>
        <dt>Tax paid from take-home · Transfers · Cash outflow</dt>
        <dd>Payments in Tax and Transfer categories, shown apart; cash outflow is living plus tax, without transfers.</dd>
        <dt>Cash saved · savings rate</dt>
        <dd>Take-home minus living and tax, as an amount and as a share of take-home. The total rate also counts payroll deductions.</dd>
        <dt>Typical</dt>
        <dd>A category\u2019s three-month median, shown beside the month you are entering.</dd>
        <dt>Eligible months · previous 12 months</dt>
        <dd>Completed months in the twelve calendar months before the focused one; a month nobody entered reduces the count.</dd>
        <dt>Closed · In progress · Ready to review · Needs review · Unreviewed history</dt>
        <dd>A month\u2019s review state. Only a closed month counts as complete; a correction after closing makes it Needs review; pre-existing data is Unreviewed history until you close it.</dd>
        <dt>Snapshot</dt>
        <dd>One month\u2019s balances, one row per account, written by the monthly update. Also: an export ZIP of everything, written nightly.</dd>
        <dt>Derived parent · component account</dt>
        <dd>A parent whose balance is the sum of its components; you type into components and the parent is read-only.</dd>
        <dt>Retired</dt>
        <dd>Kept with its history but out of the wizard and charts; delete is only for things with no history.</dd>
        <dt>Signed liabilities</dt>
        <dd>Card and loan balances are stored negative; net worth is the plain sum.</dd>
        <dt>Effective-dated budget</dt>
        <dd>A budget applies from its month forward; the month you are looking at resolves to the latest row at or before it.</dd>
        <dt>Basis (confirmed · scheduled · estimated) · your figure</dt>
        <dd>How sure a calendar amount is; your figure replaces the estimate with what you paid.</dd>
        <dt>Qualifying date · bargain element</dt>
        <dd>When an ESPP lot becomes a qualifying disposition; the discount and lookback gain at purchase.</dd>
        <dt>Cliff · focal year</dt>
        <dd>The first vest of a grant and the share it releases; the review year a grant or raise belongs to.</dd>
        <dt>Marginal rate · effective rate · safe harbor</dt>
        <dd>What the next dollar costs; total tax over gross; the withholding floor that avoids a penalty.</dd>
        <dt>FI target · FI ratio · withdrawal rate</dt>
        <dd>Annual spend over the withdrawal rate; investable balance over that target; the yearly share of the portfolio you plan to draw.</dd>
        <dt>Today\u2019s dollars · future dollars</dt>
        <dd>A display choice on Projection; dates and probabilities do not move.</dd>
        <dt>Weekly performance point</dt>
        <dd>One portfolio value per week, recorded after Monday\u2019s close, feeding the performance chart.</dd>
      </dl>
    ),
  },
  {
    id: 'ref-settings-map',
    title: 'Where to configure X',
    purpose: 'Every Settings card, by the job it does.',
    keywords: ['settings map', 'where is', 'configure'],
    tasks: [],
    body: <SettingsMapTable />,
  },
]
```

- [ ] **Step 2: Verify** — the shortcut bindings (`AmountInput.tsx:82-136`, `CommandPalette.tsx:174-191`,
`LocalSections.tsx:139-147`, `CalendarPage.tsx:213-245`), the toast constants
(`ToastProvider.tsx:41, 70-74`), the Activity undo rule (`ActivityCard.tsx:124`), the sandbox facts
(`README.md:843-866`), the assistant labels (`Ask assistant` in `paletteRegistry.ts`, `Ask the assistant`
and the three presets in `samples.ts`), `Skip to content` (`Layout.tsx:175-177`); the glossary
definitions against `metricReceipt.ts`, `monthReview.ts` and the 2026-09-12 review's vocabulary table.
`<code>` inside `body` is fine (prose is not fenced); if it renders badly, use `<b className="guide-label">`.

- [ ] **Step 3: Fences** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`.
Expected: PASS; the glossary card has no tasks and no `to` (not a page card).

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/reference.tsx
git commit -m "content(guide): Reference — typing, keyboard, undo, sandboxes, links, assistant, glossary, Settings map (spec §5.1)"
```

---

## Task 5 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
- [ ] **Step 2: Results** — append `## Results (implementer, <date>)`: commits, gate counts, labels
changed from the draft and why, deviations, hand-offs (a `.guide-glossary dt { font-weight: 600 }`
and `.guide-map` rule are likely wanted — report them for V rather than editing `GuidePage.css`).

## Self-review (done while writing)

- Spec §5.1 required ids: Projection 6 ✓; Calendar 7 ✓ (incl. canonical `calendar-subscribe`,
  `calendar-reminder-day`); Settings 10 (8 visible + `household-marriage-date`, `accounts-retire-delete`
  folded; `household-rename` extra) ✓; Settings-data 12 (8 visible + `health-checks`,
  `calendar-feed-pointer`, `calendar-reminder-pointer`, `system-status`; `settings-map` as body) ✓;
  Reference 8 cards ✓ with `assistant-open`, `assistant-ask`, `assistant-presets`, `assistant-key-pointer`.
- Required-coverage ids owned here: `accounts-add`, `accounts-owner`, `projection-assumptions`,
  `projection-retire-month`, `calendar-add-event`, `calendar-subscribe`, `assistant-ask`, `assistant-key` ✓.
- Fences: Projection `views` match; Calendar has none; both Settings cards `to: '/settings'` with
  identical `views`; visible tasks 6/7/8/8; `watch` ≤ 5; pointer tasks have one step and a real
  destination; `?add=1` and `?section=trend` are allowed params.

---

## Results (implementer, 2026-09-14)

Worktree `.worktrees/guide-g4`, branch `guide/g4-planning`, cut from G0's head `e0d289c`. Four
content commits plus this one; nothing pushed; no file outside the lane's list touched.

### Commits

| SHA | Task | Message |
| --- | --- | --- |
| `440ba36` | 1 | `content(guide): Pages — Projection (spec §5.1)` |
| `dc97b56` | 2 | `content(guide): Pages — Calendar (spec §5.1)` |
| `2939e86` | 3 | `content(guide): Pages — Settings (Household & Planning; Account, Integrations & Data) with the Settings map (spec §5.1)` |
| `ced8ed4` | 4 | `content(guide): Reference — typing, keyboard, undo, sandboxes, links, assistant, glossary, Settings map (spec §5.1)` |

Files: `src/guide/content/pages-planning.tsx` (4 cards), `src/guide/content/reference.tsx`
(8 cards), new `src/guide/content/settingsMap.tsx`, and `src/guide/content/pending.ts`
(`'/projection'`, `'/calendar'`, `'/settings'` deleted — `PENDING_PAGES` now holds G1–G3's ten).

### Gates

Per card: `npx vitest run src/guide` → 5 files, **23 passed / 1 skipped** (the skipped one is the
§5.4 required-coverage fence, still gated on `PENDING_PAGES`); `npx tsc -b` and
`npx eslint src/guide` clean each time.

Final, on `ced8ed4`:

- `npx tsc -b` — clean.
- `npx eslint .` — **0 errors, 25 warnings**, all pre-existing `react-refresh/only-export-components`
  (none in `src/guide`).
- `npx vitest run` — **231 files, 3093 passed / 1 skipped**, 172 s.
- `npm run build` — ✓ 15.78 s; the `GuidePage` chunk is 41.49 kB (13.31 kB gzip).

### Labels and facts changed from the plan's draft (with the source that settled it)

Projection

1. **Horizon** → **Horizon (years)** — the slider's label (`ScenarioPanel.tsx:36`); bare `Horizon`
   is only the scenario chip/compare-row label (`projectionScenario.ts:152`).
2. `where: 'Projection → chart controls'` → `'Projection → Projected investable balance'` (twice).
   "chart controls" exists nowhere in source and would have failed the `where` fence; the toggles
   live in that ChartCard's header (`ProjectionPage.tsx:136-160`).
3. `projection-assumptions`: the draft's one knob-listing step was 172 chars (fence: 160), so it is
   two steps; "blank means derived" now names the badge's three sources verbatim —
   **From your records** / **Settings** / **Planning default** (`ScenarioPanel.tsx:172`).
4. "Enter 5 for 5 %" → "Enter 5 for 5%" (`ScenarioHints`, `ScenarioPanel.tsx:300`).
5. `projection-outcomes`: one 185-char step → three, with the tiles named verbatim (**FI target**,
   **FI ratio**, **Investable balance**, **Projected FI date**). The fifth tile's label is composed
   at runtime (`Reach FI within {years} yrs`), so it is described, never bolded.
6. `projection-historical`: the span toggle sets how far the fit runs **forward** (SPANS = 1/5/10/40
   years of extension, `ProjectionTrendPanel.tsx:11,40`), not how much history is shown — the draft
   said "span chips widen it". Added "mounted the first time you open the tab" (the component's own
   docstring) and the under-three-snapshots behaviour (`:42`).

Calendar

7. **Save** → **Save event** (add) and **Save changes** (edit) — `AddEventForm.tsx:152`.
8. The add form's fields are now verbatim: **Date**, **Title**, **Note (optional)**, **Person**
   (with **Household** as the shared option), **Amount (optional)**, **Direction**, **Repeats**,
   **Until (optional)** (`AddEventForm.tsx:54-144`).
9. "the direction is forced to neutral" → "saved as **No direction**", the option's own label
   (`AddEventForm.tsx:117`, rule at `CalendarPage.tsx:455`).
10. `calendar-override`: **Mark done**/**Reopen** exist only on deadlines and **Hide**/**Unhide**
    on any generated event (`EventDetails.tsx:126-143`); the figure form's box is
    **Amount you paid** (`:181`).
11. `calendar-export-ics`: the file is the month on screen **plus one either side**
    (`windowFor`, `CalendarPage.tsx:50-52`) — the draft said "the visible months" — and it is a
    snapshot, not a subscription (the distinction the next task turns on).
12. `where` paths that named invisible things: `'Calendar → event popover'` → `'Calendar → Grid'`
    and `'Calendar → footer'` → `'Calendar → Sources'`. **Grid**/**List** are the view toggle's
    labels (`CalendarPage.tsx:82-85`); the health list is `aria-label="Sources"`
    (`SourceHealth.tsx:10`). Neither "event popover" nor a visible "footer" exists.
13. `calendar-subscribe`: the Google/Apple routes are the card's own sentence
    (`CalendarFeedCard.tsx:159-162`), with its arrows rewritten as commas so the step reads as prose.

Settings

14. "**Owner** blank means joint" → "pick **Joint**" — the select's first option is literally
    **Joint** and the table prints `Joint` (`AccountsCard.tsx:328, 411-414`). The "mine and ours"
    rule is verified in `net_worth_calc.py:28-45` (a person selects their accounts **plus** the
    joint ones), and the same sentence covers **Portfolio accounts**' own **Owner** column (`:511`).
15. `household-marriage-date`: **dropped "it drives married filing" — it does not.** `marriage_date`
    reaches exactly one consumer in the app, the net-worth chart's "Married" mark line
    (`NetWorthPage.tsx:458` → `netWorthChartOptions.ts:66-74`); filing status is a per-year choice on
    Taxes. The step now says that, and keeps the card's own "nothing is backfilled".
16. `restore-snapshot` and `system-status` `where`s use the cards' own headings — **Restore** and
    **System** — not the palette spellings the plan named (deviation D1 below).
17. `import-workbook`: added the picker's label **Workbook (.xlsx)**; the overwrite rule moved from a
    step into the task's `watch`, where a trap belongs, and the confirm dialog is named
    (`SettingsPage.tsx:258-262, 380-420`).
18. `health-checks`: the snapshot fix's button label comes from the **server** (`fix.label`,
    `HealthCard.tsx:127-129`), so it is described rather than bolded; the zero-month fix is
    `Delete <Month>`, armed on the first press (`:120`).
19. `limits-enter`: **Clone from** is dynamic (`Clone from ${year - 1}`, `LimitsCard.tsx:195`), so the
    step bolds the stable half and says "the year before".

Reference

20. `assistant-ask`: the composer's button is **Send** — "Ask the assistant" is the textarea's
    accessible name, so it became the `where` instead (`AssistantDrawer.tsx:896, 910`). Added the
    **Context:** strip (`:720-726`) and the evidence buttons behind a cited figure
    (`AssistantEvidence.tsx:16-20`).
21. Added `assistant-findings` — **Save finding**, **Saved findings**, **Remove saved finding**
    (`AssistantEvidence.tsx:61-95`, `AssistantDrawer.tsx:63-66`). A real affordance the draft missed.
22. Glossary, month-review row: the draft's "Closed · … · Needs review · Unreviewed history" was
    wrong on three of five. The rendered labels are Not started · In progress · Ready to review ·
    **Reviewed** · **Changed since review** · **Not yet reviewed** (`api/monthReview.ts:52-55`).
23. Glossary "Cash saved · savings rate" → "Cash saved · **Savings rate — cash**", the wizard's own
    name for it (`MonthlyUpdatePage.tsx:1789, 1885`); cash outflow = living + tax is confirmed in
    `backend/app/api/spending.py:472`.
24. Glossary "Typical" → the median of the up-to-3 latest **entered** months (`utils/spending.ts:100`),
    and "Eligible months" → a **mean** over the entered months inside the previous 12 calendar months,
    **excluding** the one on screen (`SpendingPage.tsx:530-531`).
25. Glossary: **dropped "Cliff"** — "cliff" appears only in code and on the wire (`cliff_pct`), never
    as UI text. "Focal year" stays (a real column and section head, `CompPage.tsx:323, 354`).
    "Basis" is named for what the badge prints: the basis word, or `your figure`
    (`calendarView.ts:125`).
26. `typing-formats`: added "a sign inside parentheses" to the refused list (`amount.ts:87-92`) and
    spaces/NBSP to the accepted grouping (`amount.ts:33`).
27. `typing-paste` moved from "Any entry form" to **Monthly update** — the paste handler lives on that
    page's tables alone (`MonthlyUpdatePage.tsx:1179-1236`) — and "fills downward in table order"
    became "from the pasted-into cell onward", which is what the code does (`:1193-1195`).
28. `keys-palette`: the same chord closes it (`CommandPalette.tsx:174-191`). `keys-tabs`: the arrows
    **wrap**, and the write is `replace`, hence "no new history entry"
    (`LocalSections.tsx:139-147`). `keys-calendar`: arrows move a day or a **week**, Home/End reach
    the week's ends, Enter **or Space** opens the day (`CalendarGrid.tsx:99-135`).
29. `ref-undo`, "never undone": **dropped "a card's matrix multipliers after a card Undo"** — nothing
    in source supports it and credit cards are lane G2's ground; asserting it would be a guess. The
    revoked feed link, the password sign-outs and the import/restore rule are all sourced
    (`CalendarFeedCard.tsx:98`, `SettingsPage.tsx:318`, `ActivityCard.tsx:124`).
30. `ref-sandboxes`: the tabs are **Try changes** and **What-if** (`PaycheckPage.tsx:1018`,
    `TaxesPage.tsx:137`), not the README's older "Try it"/"What if". Everything else in that card is
    README §"Sandboxes" verbatim-in-substance: `whatif=` in the URL, three pins per page in
    `localStorage`, knobs only, and the three doors out.

### Deviations from the plan

- **D1 — `where` spelling for two Settings cards.** The plan's writing rule 5 said to use the palette
  spellings `Restore a snapshot` and `System status`. I used the cards' own headings, **Restore**
  (`RestoreCard.tsx:205`) and **System** (`SystemCard.tsx`), because `types.ts` defines `where` as the
  path in **on-screen labels** and spec §5.3 rule 2 asks for the label as rendered; a reader walking
  Settings → Data sees those two words. Both spellings pass the label fence, and the palette
  spellings remain reachable as palette entries. The Settings map table uses the same headings.
- **D2 — one task beyond the draft** (`assistant-findings`, §5.1 lists the four assistant ids as
  required, not exclusive) and extra steps in six tasks where the draft packed two facts into one
  step over the 160-char fence.
- **D3 — no `views` on Calendar** (as planned) and **both Settings cards carry the identical five
  `views`** (as planned); the completeness fence is satisfied by either `to: '/settings'`, and the
  Pages chapter is still in sidebar order (fence green).
- **D4 — the draft's `page-settings` watch repeated a task step** ("the primary member can be renamed
  but never removed" appeared in both `household-rename` and `watch`). Kept once, in `watch`; the
  third watch line is now the trap that matters — nothing on this card is per-year, so re-owning an
  account rewrites how every month reads.

### Hand-offs (lane V)

1. **CSS — not edited here, as instructed.** `GuidePage.css` wants three rules for this lane's prose:
   - `.guide-glossary dt { font-weight: 600; margin-top: 0.5rem }` and
     `.guide-glossary dd { margin: 0 0 0 1rem; color: var(--muted) }` — a bare `<dl>` renders terms in
     body weight and indents definitions by the UA's 40 px.
   - `ul.guide-body { margin: 0.4rem 0; padding-left: 1.2rem }` — the UA's 40 px is deeper than
     `.guide-watch`'s 1.1 rem, so the four Reference lists sit out of line with the rest of the card.
   - `.guide-map { max-width: 72ch }` — `.data-table` is full width, and the map is prose beside a
     link; at 1920 px it stretches past the 72ch measure every other guide block keeps.
2. **Watch lines.** Per the coordinator's mid-lane note (watch lines are rendered as plain text today;
   V routes them through `renderSteps` and extends the label fence), three of this lane's watch lines
   name a control and carry `**Label**`, each verbatim from source: `No direction`
   (`AddEventForm.tsx:117`), `Unhide` (`EventDetails.tsx:143`), `Roll-up` (`AccountsCard.tsx:399`).
   They will pass the extended fence; until V lands they print literal asterisks.
3. **Coverage.** `PENDING_PAGES` still holds G1–G3's ten routes, so the §5.4 fence stays skipped. The
   eight required ids this lane owns all exist: `accounts-add`, `accounts-owner`,
   `projection-assumptions`, `projection-retire-month`, `calendar-add-event`, `calendar-subscribe`,
   `assistant-ask`, `assistant-key`.
4. **Cross-chapter anchors** (forbidden for content lanes; candidates for V's one short list):
   `calendar-feed-pointer` → `#calendar-subscribe`, `calendar-reminder-pointer` →
   `#calendar-reminder-day`, `assistant-key-pointer` → `#assistant-key`, and `ref-sandboxes`'
   Projection link → `#page-projection`.
5. **`settingsMap.tsx` renders twice on `/guide`** by design (spec §5.1): as `page-settings-data`'s
   body and as `ref-settings-map`. If the visual pass finds that heavy, the Reference copy is the one
   to keep — it is the one the palette's "where is X" queries should land on.
6. **Eyeball list for the browser walk:** the Projection card's four watch lines and the glossary
   `<dl>` are the longest blocks this lane adds; the Settings map is the only table in the guide.
