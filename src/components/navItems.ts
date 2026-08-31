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
export const NAV_SECTIONS: NavSection[] = [
  {
    heading: null,
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/update', label: 'Monthly update', icon: CalendarCheck },
    ],
  },
  {
    heading: 'Tracking',
    // Stocks then flows, matching Overview's tile/chart order (2026-08-31 audit): the
    // wealth pair (Net worth, Portfolio) reads before the flow pair (Spending, Credit cards).
    items: [
      { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
      { to: '/portfolio', label: 'Portfolio', icon: LineChart },
      { to: '/spending', label: 'Spending', icon: Wallet },
      { to: '/credit-cards', label: 'Credit cards', icon: CreditCard },
    ],
  },
  {
    heading: 'Income',
    items: [
      { to: '/paycheck', label: 'Paycheck', icon: Banknote },
      { to: '/comp', label: 'Comp', icon: Briefcase },
      { to: '/espp', label: 'ESPP', icon: PiggyBank },
    ],
  },
  {
    heading: 'Planning',
    items: [
      { to: '/taxes', label: 'Taxes', icon: Receipt },
      { to: '/projection', label: 'Projection', icon: Telescope },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    heading: null,
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items)
