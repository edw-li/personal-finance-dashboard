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
      'The first-time checklist, in the order the data depends on itself — people before what they own, accounts before the first month, category kinds before history.',
    tasks: [],
    body: (
      <ol className="guide-body">
        <li>
          <Link to="/settings?section=account#appearance">Appearance</Link> —{' '}
          <b className="guide-label">Theme</b>, <b className="guide-label">Density</b> and{' '}
          <b className="guide-label">Landing page</b>. Works before any data exists.
        </li>
        <li>
          <Link to="/settings?section=account#password">Password</Link> — replace the seeded one before this
          server is reachable from anywhere else.
        </li>
        <li>
          <Link to="/settings?section=household#household">Household</Link> —{' '}
          <b className="guide-label">Add member</b> for each person, then{' '}
          <b className="guide-label">Marriage date</b> if you are married. Adding a person backfills nothing:
          their accounts and balances start where you enter them.
        </li>
        <li>
          <Link to="/settings?section=household#accounts">Accounts</Link> — every account with its{' '}
          <b className="guide-label">Group</b> and <b className="guide-label">Owner</b>; leave{' '}
          <b className="guide-label">Owner</b> empty for a joint one. Liabilities are entered as negative
          numbers, and until one account exists the monthly wizard cannot leave{' '}
          <b className="guide-label">Balances</b>.
        </li>
        <li>
          <Link to="/settings?section=household#categories">Spending categories</Link> — add each one and set
          its kind (<b className="guide-label">Living</b> · <b className="guide-label">Tax</b> ·{' '}
          <b className="guide-label">Transfer</b>) before you enter months — changing a kind later recomputes
          every month, chart and projection.
        </li>
        <li>
          If you have the workbook: <Link to="/settings?section=data#import">Import workbook</Link> —{' '}
          <b className="guide-label">Dry run</b>, read the diff, then{' '}
          <b className="guide-label">Apply import</b>. Do it before typing tax years the workbook covers.
        </li>
        <li>
          <Link to="/update">Monthly update</Link> — your first month: Balances → Spending → Review →{' '}
          <b className="guide-label">Save progress</b>, then the confirmations and{' '}
          <b className="guide-label">Save and close month</b>. The full routine is{' '}
          <Link to="/guide?section=routines#routine-monthly">The monthly update</Link>.
        </li>
        <li>
          <Link to="/settings?section=integrations#price-refresh">Price refresh</Link> — a five-field cron in
          day names, <b className="guide-label">Save schedule</b>, then{' '}
          <b className="guide-label">Refresh now</b> for the first prices.
        </li>
        <li>
          <Link to="/portfolio?section=manage">Portfolio → Manage</Link> — the securities the import did not
          carry (tick manual pricing for a private asset) and their dated transactions. Then{' '}
          <Link to="/portfolio?section=allocation">Allocation</Link> for classifications and targets.
        </li>
        <li>
          <Link to="/settings?section=planning#limits">Contribution limits</Link> for this year, then{' '}
          <b className="guide-label">Save limits</b>; and{' '}
          <Link to="/settings?section=planning#plan-assumptions">Plan assumptions</Link> — withdrawal rate,
          ESPP ticker and discount.
        </li>
        <li>
          <Link to="/taxes">Taxes</Link> — <b className="guide-label">New tax year…</b>,{' '}
          <b className="guide-label">Filing status</b>, the tables, the inputs. The yearly version is{' '}
          <Link to="/guide?section=routines#routine-tax-season">Tax season, once a year</Link>.
        </li>
        <li>
          <Link to="/paycheck?section=profiles">Paycheck → Profiles</Link> — one profile per person: salary,
          pay periods, contribution percentages, HSA, employer match, and the optional{' '}
          <b className="guide-label">Withholding split</b>.
        </li>
        <li>
          <Link to="/comp?section=manage">Comp → Manage</Link> for grants and focal history;{' '}
          <Link to="/espp?section=lots">ESPP → Lots</Link> for offerings and lots.
        </li>
        <li>
          <Link to="/credit-cards?section=manage">Credit cards → Manage</Link> — the cards with their{' '}
          <b className="guide-label">Opened</b> dates, then their categories and multipliers.
        </li>
        <li>
          <Link to="/settings?section=integrations#calendar">Calendar feed</Link> — a{' '}
          <b className="guide-label">Monthly update reminder day</b>, and{' '}
          <b className="guide-label">New feed link</b> to subscribe a phone.
        </li>
        <li>
          <Link to="/settings?section=data#backups">Backups &amp; snapshots</Link> —{' '}
          <b className="guide-label">Snapshot now</b> once, then check the list gains a nightly entry.
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
          <Link to="/credit-cards?section=manage">Credit cards</Link>. A question about the future: the
          sandboxes on <Link to="/paycheck?section=changes">Paycheck</Link>,{' '}
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
