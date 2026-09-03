import {
  Banknote,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LineChart,
  PiggyBank,
  Receipt,
  Settings,
  Telescope,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Palette aliases: what people type when they mean this page (2026-09-03 shell spec §9). */
  keywords: string[]
}

export interface NavSection {
  /** null = ungrouped (the top pair, and Settings alone at the bottom). */
  heading: string | null
  items: NavItem[]
}

// The sidebar's shape AND the app's route registry: the title hook and the command
// palette both walk NAV_ITEMS, so a destination added here gets its document title and
// its palette entry for free (2026-08-25 polish §2/§7/§9). Labels are sentence case
// ("Net worth", not "Net Worth"); ESPP is an initialism, not a casing exception.
// `keywords` are the palette's aliases — the words a reader types when the label is not
// what comes to mind ("rsu" for Comp, "401k" for Net worth).
export const NAV_SECTIONS: NavSection[] = [
  {
    heading: null,
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, keywords: ['home', 'dashboard', 'summary'] },
      {
        to: '/update',
        label: 'Monthly update',
        icon: CalendarCheck,
        keywords: ['wizard', 'enter', 'balances', 'month'],
      },
    ],
  },
  {
    heading: 'Tracking',
    // Stocks then flows, matching Overview's tile/chart order (2026-08-31 audit): the
    // wealth pair (Net worth, Portfolio) reads before the flow pair (Spending, Credit cards).
    items: [
      {
        to: '/net-worth',
        label: 'Net worth',
        icon: TrendingUp,
        keywords: ['401k', 'accounts', 'balance', 'liabilities', 'assets'],
      },
      {
        to: '/portfolio',
        label: 'Portfolio',
        icon: LineChart,
        keywords: ['stocks', 'holdings', 'dividends', 'prices', 'refresh', 'shares'],
      },
      {
        to: '/spending',
        label: 'Spending',
        icon: Wallet,
        keywords: ['budget', 'categories', 'savings', 'expenses'],
      },
      {
        to: '/credit-cards',
        label: 'Credit cards',
        icon: CreditCard,
        keywords: ['rewards', 'cards', 'points', 'miles', 'fees'],
      },
    ],
  },
  {
    heading: 'Income',
    items: [
      {
        to: '/paycheck',
        label: 'Paycheck',
        icon: Banknote,
        keywords: ['salary', 'net pay', 'withholding', 'contributions', 'hsa'],
      },
      {
        to: '/comp',
        label: 'Comp',
        icon: Briefcase,
        keywords: ['rsu', 'vest', 'vesting', 'grant', 'equity', 'tc', 'focal'],
      },
      {
        to: '/espp',
        label: 'ESPP',
        icon: PiggyBank,
        keywords: ['lots', 'purchase', 'offering', 'discount'],
      },
    ],
  },
  {
    heading: 'Planning',
    items: [
      {
        to: '/taxes',
        label: 'Taxes',
        icon: Receipt,
        keywords: ['what-if', 'brackets', 'withholding', 'refund', 'irs', 'filing'],
      },
      {
        to: '/projection',
        label: 'Projection',
        icon: Telescope,
        keywords: ['fire', 'retire', 'forecast', 'monte carlo', 'fi'],
      },
      {
        to: '/calendar',
        label: 'Calendar',
        icon: CalendarDays,
        keywords: ['payday', 'deadline', 'events', 'ics', 'schedule'],
      },
    ],
  },
  {
    heading: null,
    items: [
      { to: '/settings', label: 'Settings', icon: Settings, keywords: ['preferences', 'options'] },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items)
