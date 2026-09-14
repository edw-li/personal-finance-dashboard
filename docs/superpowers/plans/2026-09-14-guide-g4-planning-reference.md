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
