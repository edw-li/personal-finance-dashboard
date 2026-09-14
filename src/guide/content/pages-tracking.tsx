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
  {
    id: 'page-net-worth',
    title: 'Net worth',
    purpose:
      'Every account’s balance over time and the month-to-month story. Accounts are defined in Settings; balances are entered in the monthly update.',
    to: '/net-worth',
    views: ['Overview', 'Accounts'],
    keywords: ['net worth', 'accounts', 'balances', 'assets', 'liabilities'],
    tasks: [
      {
        id: 'networth-accounts-pointer',
        title: 'Add or change an account',
        where: 'Settings → Household → Accounts',
        steps: [
          'Accounts are added, owned, retired and nested as parent and component in Settings → Household → **Accounts** — see the Settings card in this guide.',
        ],
        to: '/settings?section=household#accounts',
        keywords: ['add account', 'new account'],
      },
      {
        id: 'networth-grain',
        title: 'Read monthly or quarterly',
        where: 'Net worth → Overview',
        steps: [
          'Press **Monthly** or **Quarterly** beside the title.',
          'Under **Quarterly** a ribbon pick snaps to the last quarter that closed at or before it.',
          'A month no quarter has closed by says so rather than drawing an empty chart.',
        ],
        to: '/net-worth',
        keywords: ['quarterly', 'grain', 'monthly'],
      },
      {
        id: 'networth-past-month',
        title: 'Look at a past month’s balances',
        where: 'Net worth → Accounts',
        steps: [
          'Click a month chip in the ribbon — the table and the tiles swap to that month.',
          'The card heading names the month it shows; each chip carries that month’s net worth.',
          'The ribbon’s **Edit ↗** link opens the selected month in the monthly update.',
        ],
        to: '/net-worth?section=accounts',
        keywords: ['history', 'past month', 'balances table'],
      },
      {
        id: 'networth-stack-by',
        title: 'Change how the chart stacks',
        where: 'Net worth → Overview → By group over time',
        steps: [
          'Pick **By group**, **By owner** or **Share %** in the chart’s controls.',
          '**Share %** redraws the stack as percentages of assets and drops the net-worth line.',
          '**By owner** is hidden while the household has one person.',
        ],
        to: '/net-worth',
        keywords: ['stacked chart', 'composition', 'by owner'],
      },
      {
        id: 'networth-what-moved',
        title: 'See what moved this month',
        where: 'Net worth → Overview → What moved',
        steps: [
          'Pick **Groups** or **Accounts** in the card’s controls.',
          'The card compares the viewed snapshot with the one before it, so a ribbon pick moves it.',
          'It appears once two snapshots exist — the first month has nothing to compare with.',
        ],
        to: '/net-worth',
        keywords: ['movers', 'change', 'attribution'],
      },
      {
        id: 'networth-drilldown',
        title: 'Compare accounts over time',
        where: 'Net worth → Accounts → Account drill-down',
        steps: [
          'Click rows in the accounts table, or the chips under the chart, to add an account.',
          'Eight accounts is the cap — a further chip goes disabled instead of swallowing the click.',
          'Each account keeps its colour, so removing one never repaints the survivors.',
        ],
        to: '/net-worth?section=accounts',
        keywords: ['compare accounts', 'drill'],
      },
      {
        id: 'networth-export',
        title: 'Export a chart',
        where: 'Any chart → Export',
        steps: [
          'Press **Export** and choose **PNG**, **Copy image** or **CSV**.',
          '**Table** puts the same numbers under the chart as a table.',
        ],
        to: '/net-worth',
        keywords: ['export', 'csv', 'png', 'download chart'],
      },
    ],
    more: [
      {
        id: 'networth-window',
        title: 'Set the time window',
        where: 'Net worth → All · 1Y · YTD',
        steps: [
          'Pick **All**, **1Y** or **YTD** in the sticky row — both time charts share one axis.',
          'Ctrl and the wheel zoom a chart; the next chip snaps that zoom away.',
        ],
        to: '/net-worth',
        keywords: ['range', 'zoom', 'time window'],
      },
      {
        id: 'networth-owner-scope',
        title: 'Scope to one person',
        where: 'Net worth → Whose',
        steps: [
          'Pick a person or **Joint** — tiles, both charts and the table follow.',
          'A scope that owns no account gets one sentence and a link to **Settings → Accounts**, not zeros.',
        ],
        to: '/net-worth',
        keywords: ['owner', 'joint', 'scope'],
      },
      {
        id: 'networth-weekly-point',
        title: 'Understand the weekly performance point',
        where: 'Net worth · Portfolio',
        steps: [
          'The performance series records one point a week, after Monday’s close, on the product time zone.',
          'A refresh on another weekday keeps quotes fresh and backfills any Monday the host slept through.',
          'Re-importing the workbook overwrites Monday rows wherever the sheet reaches; later rows survive.',
        ],
        keywords: ['weekly', 'monday', 'performance history'],
      },
    ],
    watch: [
      'Liabilities are stored as negative numbers — a card balance typed positive inflates net worth.',
      'A flat month reads neutral, not green — zero is neither good nor bad.',
      'The weekly performance point is Monday-only — a refresh schedule that skips Mondays leaves gaps.',
    ],
  },
]
