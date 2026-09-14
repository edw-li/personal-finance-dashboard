import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Routines (2026-09-14 guide spec §5.1) — routine-monthly (to: '/update', so this
// card is the wizard's home for the completeness fence), routine-tax-season, routine-health.
export const ROUTINE_CARDS: GuideCard[] = [
  {
    id: 'routine-monthly',
    title: 'The monthly update',
    purpose:
      'The one place balances, spending and take-home are entered — three steps, one save, and an explicit close for the month just ended.',
    to: '/update',
    keywords: ['monthly update', 'wizard', 'enter balances', 'month end', 'ritual'],
    body: (
      <p className="guide-body">
        Do it in the first days of the month. Have ready: each account’s month-end balance, the month’s spend
        per category, and the household’s take-home. The reminder day on{' '}
        <Link to="/settings?section=integrations#calendar">Settings → Integrations → Calendar feed</Link> puts a
        Monthly update event on any calendar subscribed to the feed.
      </p>
    ),
    tasks: [
      {
        id: 'update-pick-month',
        title: 'Pick the month',
        where: 'Monthly update',
        steps: [
          'Click a month chip in the scope row.',
          'For the next uncovered month, press **Start <Month>** beside the ribbon.',
        ],
        to: '/update',
        watch: [
          'A chip fills its left half once the month has balances, its right half once it has spending.',
          'The step you were on survives a month switch — except on a month with no balances, which opens on **Balances**.',
        ],
        keywords: ['which month', 'ribbon', 'start month'],
      },
      {
        id: 'update-balances',
        title: 'Enter balances',
        where: 'Monthly update → Balances',
        steps: [
          'Type each account’s month-end balance in **This month**; **Last month** and **Δ** check it.',
          'Enter card and loan balances as negative numbers — a positive one offers **Flip sign**.',
          'Type into the component rows; a parent badged **derived** sums them and takes no typing.',
          'Set **Recorded on**, and a **Notes** line if the month needs one.',
          'Paste a spreadsheet column into the first cell you want filled.',
          'Press **Next: spending**, or press Enter twice from the last cell.',
        ],
        to: '/update?step=balances',
        watch: ['The status line under the table says what a paste landed and what it skipped.'],
        keywords: ['balances', 'account balance', 'net worth entry', 'liability'],
      },
      {
        id: 'update-spending',
        title: 'Enter spending and take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Type the month’s take-home in **Household take-home** — one figure, never per person.',
          'Type each category’s spend in **This month**; **Typical (3-mo median)** sits beside it.',
          'To record a month that really spent nothing, tick **Confirm remaining categories as $0**.',
          'Press **Next: review**.',
        ],
        to: '/update?step=spending',
        watch: [
          'A category left at its 0.00 seed is skipped, not recorded as a zero.',
          'A budgeted category shows its budget underneath and turns red when over — advisory, never a block.',
        ],
        keywords: ['spending', 'take-home', 'net pay', 'categories', 'zero month'],
      },
      {
        id: 'update-review-save',
        title: 'Review and save progress',
        where: 'Monthly update → Review',
        steps: [
          'Read the four tiles: **Net worth**, **Living spending**, **Cash outflow**, **Cash saved**.',
          'Read **Changes since last save** before you commit.',
          'Press **Save progress** — one save writes balances and spending together.',
          'Read the receipt at the top of the page.',
          'Undo the whole save from the toast, or later from **Activity**.',
        ],
        to: '/update?step=review',
        watch: [
          'Changes since last save counts the rows you changed, then lists the largest balance moves and the biggest gaps from your recent median.',
          'The receipt counts rows added, changed and unchanged per feed, and names the categories left blank.',
          'The toast’s Undo lasts six seconds — after that the Activity card is the way back.',
        ],
        keywords: ['save', 'review', 'receipt', 'undo save'],
      },
      {
        id: 'update-close',
        title: 'Close the month',
        where: 'Monthly update → Review → Confirm this month is complete',
        steps: [
          'Enter spending and a household take-home first — without them the close button stays disabled.',
          'Tick the three boxes under **Confirm this month is complete** — balances, spending, take-home.',
          'On the current month, tick the fourth box saying the figures are final.',
          'Press **Save and close month**.',
          'Change a figure afterwards and its tick clears — the month reads **Changed since review**.',
        ],
        to: '/update?step=review',
        watch: ['A future month can be saved but never closed — it waits until the period has arrived.'],
        keywords: ['close month', 'complete month', 'confirmations', 'needs review'],
      },
      {
        id: 'update-after',
        title: 'After the update',
        where: 'Overview · Spending · Net worth',
        steps: [
          'Open **Overview** and clear the **Needs attention** list — each line links to its fix.',
          'On **Spending**, the **What changed** card names the categories behind the month.',
          'On **Net worth**, **What moved** does the same for accounts and groups.',
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
          'Tick the months to close, or **Select all eligible** for one year.',
          'Tick the confirmation under the list.',
          'Press **Close selected months**.',
        ],
        to: '/update?step=review',
        watch: ['A month missing a feed cannot be ticked — its row names the feed it lacks.'],
        keywords: ['batch close', 'history', 'unreviewed'],
      },
      {
        id: 'update-delete-month',
        title: 'Delete a month',
        where: 'Monthly update → Review → Month actions',
        steps: [
          'Open the ⋯ menu beside the review status — **Month actions**.',
          'Type the month as YYYY-MM to arm the button, then press **Delete this month**.',
          'Undo from the toast, or later from **Activity**.',
        ],
        to: '/update?step=review',
        watch: [
          'The menu is offered only on a month that was already saved.',
          'Balances, spending and take-home go together — Net worth and Spending lose the month.',
        ],
        keywords: ['delete month', 'remove month'],
      },
      {
        id: 'update-clear-take-home',
        title: 'Clear a saved take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Blank the **Household take-home** box on a month that had one.',
          'Save — the month’s cashflow row is deleted and the receipt says take-home was cleared.',
        ],
        to: '/update?step=spending',
        keywords: ['remove take-home', 'clear net pay'],
      },
      {
        id: 'update-paste',
        title: 'Paste from a spreadsheet',
        where: 'Monthly update → Balances · Spending',
        steps: [
          'Copy one column of numbers, click the first cell to fill, then paste.',
          'Or copy two columns — name, then value — and paste anywhere.',
        ],
        to: '/update',
        watch: [
          'A one-column paste fills downward in table order from the cell you clicked.',
          'A two-column paste matches rows by name; an unmatched name is listed, never guessed.',
          'An empty pasted cell skips its target instead of blanking it, and the status line counts what landed.',
        ],
        keywords: ['paste', 'spreadsheet', 'clipboard'],
      },
      {
        id: 'update-phantom',
        title: 'Repair a month saved with no spending',
        where: 'Monthly update → Spending',
        steps: [
          'Enter the month’s real spending, then save.',
          'Or press **Delete the empty month** to drop the zero rows.',
        ],
        to: '/update?step=spending',
        watch: [
          'A month whose spending is all zeros with no take-home opens with a repair banner.',
          'Deleting keeps the month’s balances — only the zero spending rows go.',
        ],
        keywords: ['phantom month', 'zero month', 'repair'],
      },
      {
        id: 'update-drafts',
        title: 'Recover unsaved entries',
        where: 'Monthly update',
        steps: [
          'Reopen the month — a banner says **Restored unsaved entries**.',
          'Keep going and save them, or press **Discard restored entries**.',
        ],
        to: '/update',
        watch: [
          'Typing is kept in this browser tab, not on the server.',
          'Discarding returns every box to the figures the server holds.',
        ],
        keywords: ['draft', 'unsaved', 'restore entries'],
      },
      {
        id: 'update-conflict',
        title: 'Resolve a save conflict',
        where: 'Monthly update',
        steps: [
          'Press **Reload latest and compare draft** in the banner.',
          'Check your draft against the fresh figures, then save again.',
        ],
        to: '/update',
        watch: ['A save is refused when the month changed on the server while you typed.'],
        keywords: ['conflict', 'save refused', 'stale month'],
      },
    ],
    watch: [
      'Saving progress and closing are different — only a closed month counts toward averages, comparisons and the month other pages open on.',
      'Balances arrive pre-filled from last month; spending arrives as 0.00 seeds, and an untouched seed is never written.',
      'A month that really spent nothing needs **Confirm remaining categories as $0** — and that tick is forgotten when you switch months.',
      'Liabilities are entered as negative numbers — a positive card balance inflates net worth.',
      'Unsaved entries live in this browser tab only — another tab, or another browser, sees only what was saved.',
    ],
  },
  {
    id: 'routine-tax-season',
    title: 'Tax season, once a year',
    purpose:
      'Once a year, when the IRS and the Franchise Tax Board publish the figures: a new tax year, its tables, this year’s contribution limits.',
    keywords: ['tax season', 'new year', 'brackets', 'yearly'],
    tasks: [],
    body: (
      <ol className="guide-body">
        <li>
          <Link to="/taxes">Taxes</Link> → <b className="guide-label">New tax year…</b> → type the year →{' '}
          <b className="guide-label">Create year</b>. The tables arrive as copies of the newest year you have,
          so every figure still needs this year’s published number.
        </li>
        <li>
          Scope row → <b className="guide-label">Filing status</b> — the status this year is filed as.
        </li>
        <li>
          <Link to="/taxes?section=tables">Tax tables</Link> → enter or refresh Federal, State, Medicare, Social
          Security, Disability and Capital gains for that status. Rates go in as percents, thresholds ascend
          from 0, and no table takes more than twelve rows.
        </li>
        <li>
          A married year: while its status tab is still empty, press{' '}
          <b className="guide-label">Clone from &lt;year&gt; single tables</b>, then edit the tables badged
          “review thresholds”. Social Security and Disability come across verbatim — they are per worker, not
          per filing status.
        </li>
        <li>
          An earner on a different plan: <b className="guide-label">Add a table for &lt;person&gt;</b> under
          Social Security or Disability.
        </li>
        <li>
          <Link to="/taxes?section=inputs">Inputs</Link> → the year’s line items. A row badged “derived”
          computes itself; an <b className="guide-label">Apply</b> chip fills a box with its suggestion — last
          year’s figure, or a formula’s.
          Finish with <b className="guide-label">Save inputs</b>.
        </li>
        <li>
          <Link to="/settings?section=planning#limits">Settings → Planning → Contribution limits</Link> → pick
          the year, enter the published caps or press <b className="guide-label">Clone from &lt;year&gt;</b>,
          then <b className="guide-label">Save limits</b>.
        </li>
        <li>
          Through the year: <Link to="/taxes?section=summary">Summary</Link> →{' '}
          <b className="guide-label">Will I owe?</b> Its <b className="guide-label">Apply</b> chip writes this
          year’s vest income into the W-2 inputs, and the remedy line gives the figure to add on{' '}
          <b className="guide-label">W-4 line 4c</b> or <b className="guide-label">DE 4</b>.
        </li>
      </ol>
    ),
    watch: [
      'The tab inside Tax tables only says which tables you are editing — a married year left on the Single toggle in the scope row still computes as Single.',
      'With no tables for the year’s filing status every figure reads “—”, never 0, and the card offers **Open Tax tables**.',
      'Married filing separately carries a standing caveat — California is community property, and this calculator does not split community income.',
    ],
  },
  {
    id: 'routine-health',
    title: 'Keeping it healthy',
    purpose:
      'A short loop for the weeks between updates: work the lists to empty, keep prices fresh, keep a restore point.',
    keywords: ['health', 'maintenance', 'attention', 'backup'],
    tasks: [
      {
        id: 'health-attention',
        title: 'Work the Needs attention list',
        where: 'Overview → Needs attention',
        steps: [
          'Click a line to land where it is fixed.',
          'Work the list until it reads **No outstanding data checks**.',
        ],
        to: '/',
        watch: [
          'Every line is a condition the data proves — an overdue month, a stale quote, a failed ticker, a stale backup, a missing tax year.',
          'The card never goes away; with nothing outstanding it says so instead.',
        ],
        keywords: ['overdue', 'stale', 'attention'],
      },
      {
        id: 'health-about-number',
        title: 'Check a number that looks wrong',
        where: 'Any headline tile → About this number',
        steps: [
          'Press the ⓘ on the tile — its name is **About this number**.',
          'Read the definition, the scope, the period, and the months counted or excluded.',
          'Press **Explain this number** to hand that receipt to the assistant.',
        ],
        keywords: ['receipt', 'definition', 'wrong number', 'inspect'],
      },
    ],
    body: (
      <p className="guide-body">
        Also: <Link to="/settings?section=data#health">Data health</Link> lists the server’s failing checks —
        zero-filled months, gaps in the spending history, stale quotes, a backup that is old or unverified —
        each with its fix beside it. On <Link to="/portfolio">Portfolio</Link>, a red chip under the refresh
        line offers <b className="guide-label">Deactivate</b> for a ticker that keeps failing, and{' '}
        <b className="guide-label">Refresh prices</b> re-runs the lookup. Take your own restore point with{' '}
        <b className="guide-label">Snapshot now</b> on{' '}
        <Link to="/settings?section=data#backups">Backups &amp; snapshots</Link> before an import or a large
        edit. <Link to="/settings?section=data#activity">Activity</Link> is the undo of last resort: press a
        row’s Undo once to arm it, once more to run it.
      </p>
    ),
  },
]
