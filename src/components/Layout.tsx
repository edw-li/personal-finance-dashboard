import { Search } from 'lucide-react'
import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { getSnapshot } from '../api/snapshotCache'
import type { SystemStatus } from '../types/api'
import AssistantDrawer from './assistant/AssistantDrawer'
import CommandPalette from './CommandPalette'
import './Layout.css'
import { NAV_SECTIONS } from './navItems'
import { requestPaletteOpen } from './paletteBus'
import RouteBoundary from './RouteBoundary'
import { prefetchRoute, warmAllRoutes } from './routeChunks'
import ShellErrorBoundary from './shell/ShellErrorBoundary'
import SidebarFooter, { SYSTEM_SNAPSHOT } from './shell/SidebarFooter'
import { usePageTitle } from './usePageTitle'

// Module scope, read once: the host OS does not change mid-session, and the sidebar's
// kbd hint must name the modifier the reader actually presses. navigator.platform is
// deprecated but is still the only synchronous read of it; a wrong guess costs the hint's
// accuracy, nothing more.
const isMac = navigator.platform.startsWith('Mac')

export default function Layout() {
  const { pathname, key: locationKey } = useLocation()
  const navigationType = useNavigationType()
  usePageTitle()
  const mainRef = useRef<HTMLElement>(null)

  // The nav-reset effect below is deliberately keyed on pathname ONLY: search-param
  // navigations (drill state on Spending/CreditCards/Taxes, useArrivalParam) change
  // location.key but must not yank focus or scroll. The POP branch still needs the
  // CURRENT key and type at fire time, so both ride refs kept fresh each render.
  const navigationTypeRef = useRef(navigationType)
  const locationKeyRef = useRef(locationKey)
  useEffect(() => {
    navigationTypeRef.current = navigationType
    locationKeyRef.current = locationKey
  })

  // Record scroll depth per history entry (rAF-throttled, passive). sessionStorage, not
  // memory: the map must survive a reload for Back to keep working afterwards. We own
  // POP restoration ourselves because the browser's own restore fires before React has
  // rendered the target page and lands at a stale height.
  useEffect(() => {
    // Unguarded assignment: supported in every browser this app runs in, and platform
    // objects are extensible, so an ancient one just gets an inert own property.
    history.scrollRestoration = 'manual'
    let frame = 0
    const record = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        try {
          sessionStorage.setItem(`scroll:${locationKeyRef.current}`, String(window.scrollY))
        } catch {
          // Storage full or blocked — losing restoration is acceptable.
        }
      })
    }
    window.addEventListener('scroll', record, { passive: true })
    return () => {
      window.removeEventListener('scroll', record)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // First render is the browser's own arrival (its focus and scroll are already right);
  // every LATER pathname change is an in-app navigation, where focus would otherwise
  // strand on the unmounted page's trigger and scroll would keep the old page's depth.
  const arrivedRef = useRef(false)
  useEffect(() => {
    if (!arrivedRef.current) {
      arrivedRef.current = true
      return
    }
    if (navigationTypeRef.current === 'POP') {
      // Back/forward: put the reader where they left off (top for an entry we never
      // saw scroll). preventScroll — the focus hand-off must not fight the restore.
      mainRef.current?.focus({ preventScroll: true })
      const saved = Number(sessionStorage.getItem(`scroll:${locationKeyRef.current}`) ?? 0)
      window.scrollTo(0, Number.isFinite(saved) ? saved : 0)
      return
    }
    mainRef.current?.focus()
    window.scrollTo(0, 0)
  }, [pathname])

  // Warm every route chunk during idle time so in-app navigation never waits on the
  // network for JS. Hover/focus prefetch below covers the pre-idle window. import()
  // memoizes, so re-mounts re-warm for free (no-ops).
  useEffect(() => {
    warmAllRoutes()
  }, [])

  return (
    // Everything below is inside ONE boundary (2026-09-03 shell spec §12): the palette, the
    // drawer and the sidebar live outside RouteBoundary's reach, so until now a throw in any
    // of them unmounted the entire app and left a white page a reload could not always fix.
    // The diagnostics closure reads the footer's cached /system/status rather than fetching:
    // a boundary that needs the network to explain itself is a boundary that stays silent.
    <ShellErrorBoundary
      buildHash={__BUILD_HASH__}
      getDiagnostics={() => {
        const status = getSnapshot<SystemStatus>(SYSTEM_SNAPSHOT)
        return status ? `env=${status.environment} alembic=${status.database.alembic_head}` : ''
      }}
    >
      <div className="layout">
        {/* The app's first tabbable: a keyboard user clears the 12-link sidebar in one Tab. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <aside className="sidebar">
          <div className="sidebar-title">Finance</div>
          {/* The palette's only visible affordance (2026-09-03 shell spec §9): Ctrl/Cmd+K was
              undiscoverable, so the sidebar says it out loud. A button, not an input — the
              real search box is the palette's own, and two boxes would fight for the caret.
              It asks through the bus rather than a context: the palette is mounted once,
              below, and a context would re-render the whole shell on every keystroke. */}
          <button type="button" className="sidebar-search" onClick={requestPaletteOpen}>
            <Search size={14} aria-hidden="true" />
            <span>Search or jump…</span>
            <kbd aria-label={isMac ? 'Command K' : 'Control K'}>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <nav aria-label="Primary">
            {NAV_SECTIONS.map((section, index) => (
              <div className="nav-section" key={section.heading ?? `ungrouped-${index}`}>
                {section.heading !== null && (
                  <div className="nav-heading">{section.heading}</div>
                )}
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className="nav-link"
                    onMouseEnter={() => prefetchRoute(to)}
                    onFocus={() => prefetchRoute(to)}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          {/* Identity, deployment and build (2026-09-03 shell spec §12). It carries the old
              separator's border itself, so the bare Log-out row is gone. */}
          <SidebarFooter buildHash={__BUILD_HASH__} />
        </aside>
        {/* tabIndex -1: focusable by the skip link and the navigation hand-off above,
            never part of the tab order itself. */}
        <main id="main" tabIndex={-1} className="content" ref={mainRef}>
          {/* Route chunks resolve here — the sidebar must not unmount while one loads, and a
              chunk that never arrives must not blank the app (RouteBoundary). The fallback's
              class is .route-fallback, not panels.css's .empty-note: panels.css reaches the
              entry chunk only INCIDENTALLY (the assistant drawer below imports it), and a
              fallback that leans on a neighbor's import staying put is one refactor from
              rendering unstyled.

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
        {/* Beside the palette, and last for the same reason: both are app-wide overlays that
            outlive every route, so neither may sit inside <main> where a navigation would
            unmount it (the drawer's transcript is per-sitting, not per-page).

            Imported eagerly, like the palette, and for the same reasons: it must answer on
            every route (including one whose own chunk is still loading, or has failed), and
            lazy would put a network fetch — plus a second chunk-failure mode — between the
            keypress and the drawer taking focus. The bill is ~6.3 kB gz on the entry chunk. */}
        <AssistantDrawer />
      </div>
    </ShellErrorBoundary>
  )
}
