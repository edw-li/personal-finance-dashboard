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
          'Click a month chip in the scope row — a filled left half means balances, a filled right half spending.',
          'For the next uncovered month, press **Start <Month>** beside the ribbon.',
          'The step you were on survives the switch, unless the new month has no balances yet.',
        ],
        to: '/update',
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
          'Paste a column from a spreadsheet into the first cell to fill; the status line says what landed.',
          'Press **Next: spending**, or press Enter twice from the last cell.',
        ],
        to: '/update?step=balances',
        keywords: ['balances', 'account balance', 'net worth entry', 'liability'],
      },
      {
        id: 'update-spending',
        title: 'Enter spending and take-home',
        where: 'Monthly update → Spending',
        steps: [
          'Type the month’s take-home in **Household take-home** — one household figure, not one per person.',
          'Type each category’s spend in **This month**; **Typical (3-mo median)** sits beside it.',
          'A category left at its 0.00 seed is skipped, not recorded as a zero.',
          'To record a month that really spent nothing, tick **Confirm remaining categories as $0**.',
          'A budgeted category shows its budget underneath and turns red when over — advisory, never a block.',
          'Press **Next: review**.',
        ],
        to: '/update?step=spending',
        keywords: ['spending', 'take-home', 'net pay', 'categories', 'zero month'],
      },
      {
        id: 'update-review-save',
        title: 'Review and save progress',
        where: 'Monthly update → Review',
        steps: [
          'Read the four tiles: **Net worth**, **Living spending**, **Cash outflow**, **Cash saved**.',
          'Read **Changes since last save** — the largest balance moves and the biggest gaps from your recent median.',
          'Press **Save progress** — one save writes balances and spending together.',
          'Read the receipt at the top of the step: rows added, changed, unchanged, categories left blank.',
          'Undo the whole save from the toast for six seconds; after that, from **Activity**.',
        ],
        to: '/update?step=review',
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
          'Tick the months to close, or **Select all eligible** for one year — a row missing a feed is disabled.',
          'Tick the confirmation under the list.',
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
          'Open the ⋯ menu beside the review status — **Month actions**, offered only on a saved month.',
          'Type the month as YYYY-MM to arm the button, then press **Delete this month**.',
          'Balances, spending and take-home go together — Net worth and Spending lose the month.',
          'Undo from the toast for six seconds, or later from **Activity**.',
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
          'Copy one column of numbers, click the first cell to fill, then paste — values run down the table order.',
          'Copy two columns (name, then value) and paste anywhere — rows match by name, and a miss is listed, never guessed.',
          'An empty pasted cell skips its target instead of blanking it; the status line counts what landed.',
        ],
        to: '/update',
        keywords: ['paste', 'spreadsheet', 'clipboard'],
      },
      {
        id: 'update-phantom',
        title: 'Repair a month saved with no spending',
        where: 'Monthly update → Spending',
        steps: [
          'A month whose spending is all zeros with no take-home opens with a repair banner.',
          'Enter the real figures, or press **Delete the empty month** to drop the zero rows and keep the balances.',
        ],
        to: '/update?step=spending',
        keywords: ['phantom month', 'zero month', 'repair'],
      },
      {
        id: 'update-drafts',
        title: 'Recover unsaved entries',
        where: 'Monthly update',
        steps: [
          'Typing is kept in this browser tab; reopening the month shows **Restored unsaved entries**.',
          'Keep going and save them, or press **Discard restored entries** to return to the stored figures.',
        ],
        to: '/update',
        keywords: ['draft', 'unsaved', 'restore entries'],
      },
      {
        id: 'update-conflict',
        title: 'Resolve a save conflict',
        where: 'Monthly update',
        steps: [
          'If the month changed on the server while you typed, the save is refused and a banner appears.',
          'Press **Reload latest and compare draft** — your typing is kept beside the fresh figures.',
        ],
        to: '/update',
        keywords: ['conflict', 'save refused', 'stale month'],
      },
    ],
    watch: [
      'Saving progress and closing are different — only a closed month counts toward averages, comparisons and the month other pages open on.',
      'Balances arrive pre-filled from last month; spending arrives as 0.00 seeds, and an untouched seed is never written.',
      'A month that really spent nothing needs the $0 confirmation — and that tick is forgotten when you switch months.',
      'Liabilities are entered as negative numbers — a positive card balance inflates net worth.',
      'Unsaved entries live in this browser tab only — another tab, or another browser, sees only what was saved.',
    ],
  },
]
