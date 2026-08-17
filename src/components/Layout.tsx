import {
  Banknote,
  Briefcase,
  CalendarCheck,
  LayoutDashboard,
  LineChart,
  LogOut,
  Receipt,
  Settings,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './Layout.css'
import RouteBoundary from './RouteBoundary'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/update', label: 'Monthly update', icon: CalendarCheck },
  { to: '/net-worth', label: 'Net Worth', icon: TrendingUp },
  { to: '/spending', label: 'Spending', icon: Wallet },
  { to: '/portfolio', label: 'Portfolio', icon: LineChart },
  { to: '/taxes', label: 'Taxes', icon: Receipt },
  { to: '/espp', label: 'ESPP', icon: Banknote },
  { to: '/paycheck', label: 'Paycheck', icon: Banknote },
  { to: '/comp', label: 'Comp', icon: Briefcase },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout() {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">Finance</div>
        <nav>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className="nav-link">
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="logout-button" onClick={logout}>
          <LogOut size={16} />
          <span>Log out</span>
        </button>
      </aside>
      <main className="content">
        {/* Route chunks resolve here — the sidebar must not unmount while one loads, and a
            chunk that never arrives must not blank the app (RouteBoundary). The fallback's
            class is .route-fallback, not panels.css's .empty-note: panels.css now ships with
            the first PAGE chunk, so it is absent from the very paint this fallback owns.

            key={pathname} remounts the boundary on navigation, which is what makes the retry
            real: React.lazy memoizes the rejected import, so re-rendering the FAILED route
            just rethrows the cached rejection (status -1) — Reload stays the only fix for the
            stale-deploy case. A different pathname is a different lazy payload with its own
            untouched status, so navigating away genuinely re-attempts. Without the key, one
            transient blip would latch the boundary and lock every other route behind it. */}
        <RouteBoundary key={pathname}>
          <Suspense fallback={<p className="route-fallback" role="status">Loading…</p>}>
            <Outlet />
          </Suspense>
        </RouteBoundary>
      </main>
    </div>
  )
}
