import { Link } from 'react-router-dom'
import type { GuideCard } from '../types'

// Chapter: Routines (2026-09-14 guide spec §5.1) — routine-monthly (to: '/update', so this
// card is the wizard's home for the completeness fence), routine-tax-season, routine-health.
export const ROUTINE_CARDS: GuideCard[] = [
  {
    id: 'routine-monthly',
    title: 'The monthly update',
    purpose:
      'Two parts on their own schedule — the 1st’s balances, and the ended month’s spending and take-home once it has posted — then an explicit close for that month.',
    to: '/update',
    keywords: ['monthly update', 'wizard', 'enter balances', 'month end', 'ritual', 'what is due', 'provisional'],
    // The two-part routine (2026-09-23 spec §M7): balances on the 1st, the month just ended once it
    // has posted, each saved on its own.
    body: (
      <p className="guide-body">
        Two parts on their own schedule. On the 1st, record that day’s balances. Once the month just ended has
        posted — usually a few days later — enter its spending and take-home, then review and close it. Saving
        one part never touches the other; balances recorded early stay provisional until you save them again on
        or after their date. The reminder day on{' '}
        <Link to="/settings?section=integrations#calendar">Settings → Integrations → Calendar feed</Link> puts a
        Monthly update event on any calendar subscribed to the feed.
      </p>
    ),
    tasks: [
      {
        id: 'update-whats-due',
        title: 'Open what is due',
        where: 'Monthly update',
        steps: [
          'Open **Monthly update** — it lands on the first part that is due, balances first.',
          'The strip at the top names every due part; press one to open it.',
        ],
        to: '/update',
        watch: [
          'A part turns amber once overdue — by default, balances from the 7th and the ended month’s spending and take-home from the 16th; both move with the reminder day.',
          'With nothing due, the strip says when the next balances fall due.',
        ],
        keywords: ['what is due', 'due', 'overdue', 'reminder'],
      },
      {
        id: 'update-balances',
        title: 'Record the 1st’s balances',
        where: 'Monthly update → Balances',
        steps: [
          'Type each account’s balance on the 1st; the column before it and **Δ since <Date>** check it.',
          'Enter card and loan balances as negative numbers — a positive one offers **Flip sign**.',
          'Type into the component rows; a parent badged **derived** sums them and takes no typing.',
          'Add a **Notes** line if the month needs one.',
          'Paste a spreadsheet column into the first cell you want filled.',
          'Press **Save <Date> balances**, or press Enter twice from the last cell.',
        ],
        to: '/update?step=balances',
        watch: [
          'The line under the heading says which day the balances describe and when they were recorded.',
          'Balances saved before their date stay provisional; from their date on, **Confirm <Date> balances** makes them final.',
          'Saving balances never touches the month’s spending or take-home.',
        ],
        keywords: ['balances', 'account balance', 'net worth entry', 'liability', 'confirm balances', 'provisional'],
      },
      {
        id: 'update-spending',
        title: 'Enter last month’s spending and take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Once the month has ended and its charges have posted, open its **Spending** step.',
          'Type the month’s take-home in **Household take-home** — one figure, never per person.',
          'Type each category’s spend; **Typical (3-mo median)** sits beside it.',
          'To record a month that really spent nothing, tick **Confirm remaining categories as $0**.',
          'Press **Save <Month> spending**.',
        ],
        to: '/update?step=spending',
        watch: [
          'A category left at its 0.00 seed is skipped, not recorded as a zero.',
          'Saving spending never creates or changes the month’s balances.',
          'A charge that posts later is a plain edit — change the figure and save again.',
          'A budgeted category shows its budget underneath and turns red when over — advisory, never a block.',
        ],
        keywords: ['spending', 'take-home', 'net pay', 'categories', 'zero month', 'late charge'],
      },
      {
        id: 'update-confirm-spending',
        title: 'Confirm last month’s spending is complete',
        where: 'Monthly update → Spending',
        steps: [
          'Spending saved while its month was running stays partly entered once the month ends.',
          'Add anything that has posted since and save — or, if nothing has, press **Confirm <Month> spending is complete**.',
        ],
        to: '/update?step=spending',
        watch: [
          'Until then the month stays out of budget suggestions, and its charts draw it as partly entered.',
          'A take-home saved on its own never completes the month’s spending.',
        ],
        keywords: ['partial month', 'confirm spending', 'rent', 'spending complete'],
      },
      {
        id: 'update-close',
        title: 'Review and close the month',
        where: 'Monthly update → Review → Confirm this month is complete',
        steps: [
          'Read the month’s story: its spending and take-home, and the change from its 1st to the next 1st.',
          'Tick the three boxes under **Confirm this month is complete** — balances, spending, take-home.',
          'On the current month, tick the fourth box saying the figures are final.',
          'Press **Save and close <Month>** — or **Save progress**, which writes only the parts you changed.',
          'Change a figure afterwards and its tick clears — the month reads **Changed since review**.',
        ],
        to: '/update?step=review',
        watch: [
          'Close stays off until the month has balances, spending and a take-home — and while its balances are provisional.',
          'The receipt at the top of the page counts rows added, changed and unchanged per part, and the categories left blank.',
          'The toast’s Undo lasts six seconds — after that the Activity card is the way back.',
        ],
        keywords: ['close month', 'complete month', 'confirmations', 'needs review', 'save progress', 'receipt', 'undo save'],
      },
      {
        id: 'update-early-balances',
        title: 'Record next month’s balances early',
        where: 'Monthly update',
        steps: [
          'Optional: press **Record <Date> balances early** beside the months.',
          'Save them as usual — they stay provisional until you save them again on or after their date.',
        ],
        to: '/update',
        watch: ['Only next month opens early; its spending waits until the month begins.'],
        keywords: ['early balances', 'provisional', 'next month'],
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
        id: 'update-pick-month',
        title: 'Pick the month',
        where: 'Monthly update',
        steps: ['Click a month chip in the scope row, or a part in the strip at the top.'],
        to: '/update',
        watch: [
          'A chip’s left half is the month’s balances and its right half its spending — hollow until entered.',
          'The step you were on survives a month switch.',
          'Only next month opens ahead of time, and only for its balances.',
        ],
        keywords: ['which month', 'ribbon', 'month chip'],
      },
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
        id: 'update-delete-part',
        title: 'Delete a month’s balances or its spending',
        where: 'Monthly update → Balances · Spending',
        steps: [
          'Open the ⋯ menu beside the step’s heading — **Actions for <Date> balances** or **Actions for <Month> spending & take-home**.',
          'Type the month as YYYY-MM, then press **Delete <Date> balances** or **Delete <Month> spending & take-home**.',
          'Undo from the toast, or later from **Activity**.',
        ],
        to: '/update?step=balances',
        watch: [
          'Each delete removes one part — the month’s other part stays.',
          'The menu is offered only on a part that was saved.',
        ],
        keywords: ['delete month', 'remove month', 'delete balances', 'delete spending'],
      },
      {
        id: 'update-clear-take-home',
        title: 'Clear a saved take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Blank the **Household take-home** box on a month that had one.',
          'Press **Save <Month> spending** — the month’s cashflow row is deleted and the receipt says take-home was cleared.',
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
          'Reopen the month — a banner names the part it restored: its balances, or its spending & take-home.',
          'Keep going and save it, or press **Discard restored balances** or **Discard restored spending**.',
        ],
        to: '/update',
        watch: [
          'Each part keeps its own draft — discarding one leaves the other.',
          'Typing is kept in this browser tab, not on the server.',
          'Discarding returns that part’s boxes to the figures the server holds.',
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
      'Balances arrive pre-filled from the 1st before; spending arrives as 0.00 seeds, and an untouched seed is never written.',
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
    // The yearly sequence is a numbered rail, not prose (2026-09-15 polish spec §5.2): the
    // eight steps of the ordered list, one task each, read in order.
    numbered: true,
    tasks: [
      {
        id: 'season-new-year',
        title: 'Create the year',
        where: 'Taxes → New tax year…',
        steps: [
          '**New tax year…** → type the year → **Create year**.',
          'The tables arrive as copies of the newest year you have, so every figure still needs this year’s published number.',
        ],
        to: '/taxes',
      },
      {
        id: 'season-status',
        title: 'Set the filing status',
        where: 'Taxes → Filing status',
        steps: [
          'In the scope row, **Filing status** names the status this year is filed as; press its Change… button, pick another and confirm with **Change to <status>**.',
        ],
        to: '/taxes',
        watch: ['Every year starts Single.'],
      },
      {
        id: 'season-tables',
        title: 'Enter the tables',
        where: 'Taxes → Tax tables',
        steps: [
          'Enter or refresh Federal, State, Medicare, Social Security, Disability and Capital gains for that status.',
          'Rates go in as percents, thresholds ascend from 0, and no table takes more than twelve rows.',
        ],
        to: '/taxes?section=tables',
      },
      {
        id: 'season-clone',
        title: 'Clone for a married year',
        where: 'Taxes → Tax tables',
        steps: [
          'A married year: while its status tab is still empty, press **Clone from <year> single tables**.',
          'Then edit the tables badged “review thresholds”.',
          'Social Security and Disability come across verbatim — they are per worker, not per filing status.',
        ],
        to: '/taxes?section=tables',
      },
      {
        id: 'season-per-person',
        title: 'Add a per-worker table',
        where: 'Taxes → Tax tables',
        steps: ['An earner on a different plan: **Add a table for <person>** under Social Security or Disability.'],
        to: '/taxes?section=tables',
      },
      {
        id: 'season-inputs',
        title: 'Enter the inputs',
        where: 'Taxes → Inputs',
        steps: [
          'The year’s line items. A row badged “derived” computes itself.',
          'An **Apply** chip fills a box with its suggestion — last year’s figure, or a formula’s.',
          'Finish with **Save inputs**.',
        ],
        to: '/taxes?section=inputs',
      },
      {
        id: 'season-limits',
        title: 'Enter this year’s limits',
        where: 'Settings → Planning → Contribution limits',
        steps: ['Pick the year, enter the published caps or press **Clone from <year>**, then **Save limits**.'],
        to: '/settings?section=planning#limits',
        watch: ['The Paycheck pace meters and the sandbox presets need these limits.'],
      },
      {
        id: 'season-owe',
        title: 'Watch Will I owe? through the year',
        where: 'Taxes → Summary → Will I owe?',
        steps: [
          'Open **Will I owe?** through the year.',
          'Its **Apply** chip writes this year’s vest income into the W-2 inputs.',
          'The remedy line gives the figure to add on **W-4 line 4c** or **DE 4**.',
        ],
        to: '/taxes?section=summary',
      },
    ],
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
