import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Start here (2026-09-14 guide spec §5.1). Card ids are fixed by the spec:
// start-what · start-organized · start-setup · start-next. G1 owns everything below the
// exemplar; the exemplar shows the voice (task-first, sentence case, the em-dash consequence
// clause, honest about what is not saved) and the shape (purpose + body, no tasks).
export const START_CARDS: GuideCard[] = [
  {
    id: 'start-what',
    title: 'What this dashboard does',
    purpose:
      'A self-hosted dashboard for one household’s money: you enter balances, spending and take-home once a month, prices refresh on a schedule, everything else is computed.',
    tasks: [],
    body: (
      <>
        <p className="guide-body">
          Nothing leaves your server except price lookups and, if you turn it on, the questions you ask
          the assistant. Two people can be tracked; most pages have a <b className="guide-label">Whose</b>{' '}
          chip in the sticky row under the title.
        </p>
        <p className="guide-body">
          Three rhythms: set it up once in <Link to="/settings?section=household">Settings</Link>, update it
          every month in <Link to="/update">Monthly update</Link>, and refresh tax tables and contribution
          limits once a year on <Link to="/taxes">Taxes</Link> and{' '}
          <Link to="/settings?section=planning">Settings → Planning</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'start-organized',
    title: 'How it is organized',
    purpose:
      'The sidebar in five groups, a tab strip on most pages, one sticky row for scope, and a few shell controls that work everywhere.',
    tasks: [],
    body: (
      <>
        <ul className="guide-body">
          <li>
            <b className="guide-label">Overview</b> and <b className="guide-label">Monthly update</b> sit on
            top: the briefing, and the one place data is entered.
          </li>
          <li>
            <b className="guide-label">Tracking</b> — Net worth, Portfolio, Spending, Credit cards: what you
            have and what you spend.
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
          Most pages carry tabs under their title — their views. The address keeps the view, so Back works and
          a link opens the same view for someone else.
        </p>
        <p className="guide-body">
          The sticky row under the title holds the scope: <b className="guide-label">Whose</b> (All, each
          person, Joint), the time window (<b className="guide-label">All</b> ·{' '}
          <b className="guide-label">1Y</b> · <b className="guide-label">YTD</b>) and, on pages that have one,
          the month ribbon — twelve chips whose left half fills once the month has balances and right half once
          it has spending, with a ring on the current month.
        </p>
        <p className="guide-body">
          <b className="guide-label">Ctrl K</b> (⌘K on a Mac) opens the command palette: pages, Settings cards,
          actions, holdings, accounts, categories, cards — and every task in this guide.
        </p>
        <p className="guide-body">
          An ⓘ beside a title explains that card in a sentence — hover to open it, click to pin it. The ⓘ on a
          headline tile is a different button, <b className="guide-label">About this number</b>: it opens that
          figure’s receipt, and <b className="guide-label">Explain this number</b> hands the receipt to the
          assistant.
        </p>
        <p className="guide-body">
          The sparkle button at the bottom right (<b className="guide-label">Open assistant</b>) needs a key
          saved in{' '}
          <Link to="/settings?section=integrations#assistant">Settings → Integrations → Assistant</Link>.
          Nothing is sent until you ask a question.
        </p>
        <p className="guide-body">
          A save shows a toast for six seconds; many carry <b className="guide-label">Undo</b>. Once it is
          gone, <Link to="/settings?section=data#activity">Settings → Data → Activity</Link> is where a
          money-bearing change is reversed.
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
      'The first-time checklist, in the order the data depends on — people before what they own, accounts before the first month, category kinds before history.',
    // The checklist is a numbered rail, not prose (2026-09-15 polish spec §5.1): one task per
    // step, read in order, with the dependencies that make the order matter as `watch` lines.
    numbered: true,
    keywords: ['setup', 'checklist', 'first time', 'getting started'],
    tasks: [
      {
        id: 'setup-appearance',
        title: 'Pick a theme and a landing page',
        where: 'Settings → Account → Appearance',
        steps: ['Choose **Theme**, **Density** and **Landing page**.', 'Works before any data exists.'],
        to: '/settings?section=account#appearance',
      },
      {
        id: 'setup-password',
        title: 'Change the password',
        where: 'Settings → Account → Password',
        steps: ['Replace the seeded one before this server is reachable from anywhere else.'],
        to: '/settings?section=account#password',
      },
      {
        id: 'setup-household',
        title: 'Add the household',
        where: 'Settings → Household → Household',
        steps: [
          'Press **Add member** for each person.',
          'Then **Marriage date** if you are married — it marks the net-worth trend and nothing else; filing status is chosen per year on Taxes.',
          'Adding a person backfills nothing: their accounts and balances start where you enter them.',
        ],
        to: '/settings?section=household#household',
      },
      {
        id: 'setup-accounts',
        title: 'Add the accounts',
        where: 'Settings → Household → Accounts',
        steps: [
          'Every account with its **Group** and **Owner**; leave **Owner** empty for a joint one.',
          'Liabilities are entered as negative numbers.',
          'Until one account exists the monthly wizard cannot leave **Balances**.',
        ],
        to: '/settings?section=household#accounts',
        watch: ['Depends on 3 · Add the household — a person before the things they own.'],
      },
      {
        id: 'setup-categories',
        title: 'Add spending categories and their kinds',
        where: 'Settings → Household → Spending categories',
        steps: [
          'Add each one and set its kind (**Living** · **Tax** · **Transfer**) before you enter months.',
          'Changing a kind later recomputes every month, chart and projection.',
        ],
        to: '/settings?section=household#categories',
      },
      {
        id: 'setup-import',
        title: 'Import the workbook',
        where: 'Settings → Data → Import workbook',
        steps: [
          'If you have the workbook: **Dry run**, read the diff, then **Apply import**.',
          'Do it before typing tax years the workbook covers.',
        ],
        to: '/settings?section=data#import',
      },
      {
        id: 'setup-first-month',
        title: 'Enter the first month',
        where: 'Monthly update',
        steps: [
          'Your first month: Balances → Spending → Review → **Save progress**.',
          'Then the confirmations and **Save and close month**.',
          'The full routine is the Routines chapter’s first card.',
        ],
        to: '/update',
        watch: [
          'Depends on 4 · Add the accounts — the wizard needs at least one.',
          'Depends on 5 · Add spending categories and their kinds — set the kinds before you enter months.',
        ],
      },
      {
        id: 'setup-prices',
        title: 'Set the price refresh',
        where: 'Settings → Integrations → Price refresh',
        steps: [
          'A five-field cron in day names, then **Save schedule**.',
          'Then **Refresh now** for the first prices.',
        ],
        to: '/settings?section=integrations#price-refresh',
        watch: ['Keep Mondays covered — the Monday run records the weekly performance point.'],
      },
      {
        id: 'setup-portfolio',
        title: 'Fill the portfolio',
        where: 'Portfolio → Manage',
        steps: [
          'The securities the import did not carry (tick manual pricing for a private asset) and their dated transactions.',
          'Then **Allocation** for classifications and targets.',
        ],
        to: '/portfolio?section=manage',
      },
      {
        id: 'setup-limits',
        title: 'Enter limits and plan assumptions',
        where: 'Settings → Planning',
        steps: [
          '**Contribution limits** for this year, then **Save limits**.',
          'And **Plan assumptions** — withdrawal rate, ESPP ticker and discount.',
        ],
        to: '/settings?section=planning#limits',
      },
      {
        id: 'setup-taxes',
        title: 'Create the tax year',
        where: 'Taxes',
        steps: [
          '**New tax year…**, **Filing status**, the tables, the inputs.',
          'The yearly version is Tax season, once a year, in the Routines chapter.',
        ],
        to: '/taxes',
        watch: ['Depends on 6 · Import the workbook — do it before typing tax years the workbook covers.'],
      },
      {
        id: 'setup-paycheck',
        title: 'Add paycheck profiles',
        where: 'Paycheck → Profiles',
        steps: [
          'One profile per person: salary, pay periods, contribution percentages, HSA, employer match.',
          'And the optional **Withholding split**.',
        ],
        to: '/paycheck?section=profiles',
      },
      {
        id: 'setup-comp-espp',
        title: 'Add grants and ESPP offerings',
        where: 'Comp → Manage · ESPP → Lots',
        steps: ['Comp → **Manage** for grants and focal history.', 'ESPP → **Lots** for offerings and lots.'],
        to: '/comp?section=manage',
      },
      {
        id: 'setup-cards',
        title: 'Add the credit cards',
        where: 'Credit cards → Manage',
        steps: ['The cards with their **Opened** dates, then their categories and multipliers.'],
        to: '/credit-cards?section=manage',
      },
      {
        id: 'setup-calendar',
        title: 'Set the calendar feed',
        where: 'Settings → Integrations → Calendar feed',
        steps: ['A **Monthly update reminder day**.', 'And **New feed link** to subscribe a phone.'],
        to: '/settings?section=integrations#calendar',
      },
      {
        id: 'setup-snapshot',
        title: 'Take a snapshot',
        where: 'Settings → Data → Backups & snapshots',
        steps: ['**Snapshot now** once, then check the list gains a nightly entry.'],
        to: '/settings?section=data#backups',
      },
      {
        id: 'setup-budgets',
        title: 'Seed budgets',
        where: 'Spending → Budgets',
        steps: ['After three complete months: **Start from my averages**.'],
        to: '/spending?section=budgets',
        watch: ['Depends on 7 · Enter the first month — only a closed month counts toward the averages.'],
      },
      {
        id: 'setup-assistant',
        title: 'Turn on the assistant',
        where: 'Settings → Integrations → Assistant',
        steps: [
          'Optional, and last because everything above feeds it.',
          'Paste an **NVIDIA API key** and press **Save assistant settings** to turn the drawer on.',
        ],
        to: '/settings?section=integrations#assistant',
      },
    ],
  },
  {
    id: 'start-next',
    title: 'What happens next',
    purpose: 'Three rhythms after setup: every month, every year, and whenever something changes.',
    tasks: [],
    body: (
      <ul className="guide-body">
        <li>
          <b>Every month</b> — the{' '}
          <Link to="/guide?section=routines#routine-monthly">monthly update</Link> in the first days of the
          month, then a look at <Link to="/">Overview → Needs attention</Link>.
        </li>
        <li>
          <b>Every year</b> — <Link to="/guide?section=routines#routine-tax-season">tax season</Link>: a new
          tax year, its tables, this year’s contribution limits.
        </li>
        <li>
          <b>Whenever</b> — a raise or an election change: a new{' '}
          <Link to="/paycheck?section=profiles">paycheck profile</Link>. A grant:{' '}
          <Link to="/comp?section=manage">Comp</Link>. An enrollment window:{' '}
          <Link to="/espp?section=lots">ESPP</Link>. A new card:{' '}
          <Link to="/credit-cards?section=manage">Credit cards</Link>. A question about the future:{' '}
          <Link to="/guide?section=reference#ref-sandboxes">the sandboxes</Link> on{' '}
          <Link to="/paycheck?section=changes">Paycheck</Link>,{' '}
          <Link to="/taxes?section=whatif">Taxes</Link> and <Link to="/projection">Projection</Link> — nothing
          in them is saved.
        </li>
        <li>
          <b>When a number looks wrong</b> —{' '}
          <Link to="/guide?section=routines#routine-health">Keeping it healthy</Link>.
        </li>
      </ul>
    ),
  },
]
