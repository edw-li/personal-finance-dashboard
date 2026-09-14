import type { GuideCard } from '../types'

// Chapter: Pages — Overview, Net worth, Portfolio, Spending, Credit cards, in sidebar order
// (2026-09-14 guide spec §5.1). Written by lane G2 from research §5.3 P1–P5; every bold label
// and every `where` segment verified against the page source before it was written down.
export const TRACKING_CARDS: GuideCard[] = [
  {
    id: 'page-overview',
    title: 'Overview',
    purpose:
      'A read-only briefing: headline tiles, the year so far, the trend, what needs attention and what is coming. No figures are edited here.',
    to: '/',
    keywords: ['overview', 'home', 'dashboard', 'briefing'],
    tasks: [
      {
        id: 'overview-whose',
        title: 'Switch whose figures you see',
        where: 'Overview → Whose',
        steps: [
          'Pick **All**, a person or **Joint** in the sticky row — the chips appear once two people exist.',
          'Net worth, the tiles and holdings follow the choice.',
          'Spending and portfolio performance have no owner dimension; their hints say so rather than filtering.',
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
          'Tick or untick items under **Summary tiles** and **Deeper views**.',
          'Reorder an item with its ↑ or ↓ button; **Reset to defaults** restores the shipped order.',
          'Press **Done** — the layout saves to your account, not to this browser alone.',
        ],
        to: '/',
        watch: ['The last remaining summary tile cannot be unticked — the tile row never goes empty.'],
        keywords: ['layout', 'hide tile', 'reorder'],
      },
      {
        id: 'overview-attention',
        title: 'Act on Needs attention',
        where: 'Overview → Needs attention',
        steps: [
          'Each line is a condition the data proves — an overdue update, missing spending, stale quotes, a failed ticker, a stale backup, a missing tax year.',
          'Click a line to land on the page that fixes it.',
          'With nothing outstanding the card reads **No outstanding data checks**.',
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
          'One failed feed shows a banner with **Retry** and leaves the other sections on screen.',
        ],
        to: '/',
        keywords: ['reload', 'refresh overview'],
      },
    ],
    more: [
      {
        id: 'overview-drill',
        title: 'Jump from a chart into its page',
        where: 'Overview → Net worth trend · Recent spending',
        steps: [
          'Click a point on **Net worth trend** — a panel opens with that month\u2019s figure.',
          'Press **Open net worth records** for that month\u2019s accounts.',
          'A **Recent spending** bar opens the same panel with **Open spending**.',
        ],
        to: '/',
        keywords: ['drill', 'chart click'],
      },
      {
        id: 'overview-data-status',
        title: 'Read how fresh the data is',
        where: 'Overview → Data status',
        steps: [
          '**Prices as of** is the oldest quote on file — the staleness clock, not the newest quote.',
          'Balances, spending and net pay each name the month they run through.',
          'A hand-entered feed a whole month behind the balances turns amber.',
        ],
        to: '/',
        keywords: ['freshness', 'stale', 'as of'],
      },
      {
        id: 'overview-up-next',
        title: 'See what is coming',
        where: 'Overview → Up next',
        steps: [
          'Deadlines due within two weeks sort first, then everything by date — five rows, at most one payday.',
          'The line beneath sums what the next 45 days move in and out, including rows the list dropped.',
          'Press **Open calendar** for the rest of the window.',
        ],
        to: '/calendar',
        keywords: ['upcoming', 'events', 'deadlines'],
      },
    ],
    watch: [
      'The portfolio day change is dated from the newest quote — it names that day, not today, unless the quote is today\u2019s.',
      'A month with net pay but no spending entered reads "—" on the Living spending tile, not $0.',
      'Spending and portfolio performance stay household-wide under every Whose chip — the numbers are not filtered.',
    ],
  },
]
