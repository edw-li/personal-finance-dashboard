import { LogOut } from 'lucide-react'
import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import CommandPalette from './CommandPalette'
import './Layout.css'
import { NAV_SECTIONS } from './navItems'
import RouteBoundary from './RouteBoundary'
import { usePageTitle } from './usePageTitle'

export default function Layout() {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  usePageTitle()
  const mainRef = useRef<HTMLElement>(null)
  // First render is the browser's own arrival (its focus and scroll are already right);
  // every LATER pathname change is an in-app navigation, where focus would otherwise
  // strand on the unmounted page's trigger and scroll would keep the old page's depth.
  const arrivedRef = useRef(false)
  useEffect(() => {
    if (!arrivedRef.current) {
      arrivedRef.current = true
      return
    }
    mainRef.current?.focus()
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="layout">
      {/* The app's first tabbable: a keyboard user clears the 12-link sidebar in one Tab. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-title">Finance</div>
        <nav aria-label="Primary">
          {NAV_SECTIONS.map((section, index) => (
            <div className="nav-section" key={section.heading ?? `ungrouped-${index}`}>
              {section.heading !== null && (
                <div className="nav-heading">{section.heading}</div>
              )}
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className="nav-link">
                  <Icon size={16} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-separator" aria-hidden="true" />
        <button className="logout-button" onClick={logout}>
          <LogOut size={16} />
          <span>Log out</span>
        </button>
      </aside>
      {/* tabIndex -1: focusable by the skip link and the navigation hand-off above,
          never part of the tab order itself. */}
      <main id="main" tabIndex={-1} className="content" ref={mainRef}>
        {/* Route chunks resolve here — the sidebar must not unmount while one loads, and a
            chunk that never arrives must not blank the app (RouteBoundary). The fallback's
            class is .route-fallback, not panels.css's .empty-note: panels.css travels with
            its importers, not this file, so this fallback cannot rely on it.

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
      <CommandPalette />
    </div>
  )
}
