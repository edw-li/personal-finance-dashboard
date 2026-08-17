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
import { NavLink, Outlet } from 'react-router-dom'
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
            the first PAGE chunk, so it is absent from the very paint this fallback owns. */}
        <RouteBoundary>
          <Suspense fallback={<p className="route-fallback">Loading…</p>}>
            <Outlet />
          </Suspense>
        </RouteBoundary>
      </main>
    </div>
  )
}
