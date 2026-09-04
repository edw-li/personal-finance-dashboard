import { Search } from 'lucide-react'
import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { markLanded } from '../prefs/LandingRedirect'
import AssistantDrawer from './assistant/AssistantDrawer'
import CommandPalette from './CommandPalette'
import './Layout.css'
import { NAV_SECTIONS } from './navItems'
import { requestPaletteOpen } from './paletteBus'
import RouteBoundary from './RouteBoundary'
import { prefetchRoute, warmAllRoutes } from './routeChunks'
import ShellErrorBoundary from './shell/ShellErrorBoundary'
import SidebarFooter, { getLastSystemStatus } from './shell/SidebarFooter'
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

  // The shell mounting IS the tab's arrival, whatever page it arrived on (2026-09-03
  // data-lifecycle spec §10). It belongs here rather than in LandingRedirect because that
  // component only ever mounts on `/`: a tab that opened on /net-worth would leave the flag
  // unset and turn the next Overview CLICK into a landing-page redirect. Mount-only, and
  // effects run after render, so the `/` route's own decision is already made when it fires.
  useEffect(() => {
    markLanded()
  }, [])

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

  // ONE accent bar for the whole nav (2026-09-05 spec §5), measured rather than assumed:
  // rows are not a fixed height (section headings, the compact density, a label that
  // wraps), so a CSS-only bar would hard-code a rhythm and drift the day a destination is
  // added. Reads only — no state, so a measurement can never cost a render — and the
  // writes are ref writes inside an effect, which is where they belong.
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  // Whether a measurement has already been committed. The FIRST placement is where the bar
  // LIVES, not a move: a cold load onto /spending would otherwise sweep the accent down
  // five rows over --t-nav before the reader has read anything.
  const placedRef = useRef(false)
  useEffect(() => {
    const place = () => {
      const nav = navRef.current
      const bar = indicatorRef.current
      if (nav === null || bar === null) return
      const active = nav.querySelector<HTMLElement>('a.active')
      if (active === null) {
        // A route no nav entry owns (the 404, a deep link): a bar left where it was would
        // claim the reader is on a page they are not.
        bar.style.opacity = '0'
        return
      }
      // data-placed goes on BEFORE the style writes below and only from the second
      // placement onwards: Layout.css hangs the transition on that attribute, so the
      // opening measurement lands instantly and every later one — a route change, a
      // density reflow, a resize — animates in the same style change that moves the bar.
      if (placedRef.current) bar.dataset.placed = ''
      const box = active.getBoundingClientRect()
      bar.style.opacity = '1'
      bar.style.height = `${box.height}px`
      bar.style.transform = `translateY(${box.top - nav.getBoundingClientRect().top}px)`
      placedRef.current = true
    }
    place()
    window.addEventListener('resize', place)
    // Rows also move without the window doing anything — the density toggle rescales the
    // root font, and neither pathname nor viewport changes when it does. Guarded for jsdom
    // and old browsers (PageFrame's IntersectionObserver idiom): without it the bar simply
    // waits for the next navigation.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place())
    if (navRef.current !== null) observer?.observe(navRef.current)
    return () => {
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
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
    // The diagnostics closure reads what the footer already fetched rather than fetching: a
    // boundary that needs the network to explain itself is a boundary that stays silent.
    //
    // resetKey, not key={pathname}: location.key changes on every navigation, and a PROP lets
    // the boundary clear itself while the palette and the drawer inside it keep their state
    // (a key would remount them, and the drawer's transcript is per-sitting, not per-page).
    <ShellErrorBoundary
      buildHash={__BUILD_HASH__}
      resetKey={locationKey}
      getDiagnostics={() => {
        const status = getLastSystemStatus()
        if (status === null) return ''
        // `none (create_all)`, not `null`: a schema built by create_all genuinely has no
        // alembic head, and "null" in a pasted report reads like the report is broken.
        const head = status.database.alembic_head ?? 'none (create_all)'
        return `env=${status.environment} alembic=${head}`
      }}
    >
      <div className="layout">
        {/* The app's first tabbable: a keyboard user clears the 12-link sidebar in one Tab. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <aside className="sidebar">
          <div className="sidebar-title">Personal finance</div>
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
          <nav aria-label="Primary" ref={navRef}>
            {/* Decorative: aria-current already announces the current page, and a second
                announcement would read the same fact twice. */}
            <div className="nav-indicator" ref={indicatorRef} aria-hidden="true" />
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
          {/* ONE Suspense, OUTSIDE the boundary, which now carries resetKey instead of key
              (2026-09-05 spec §2). Keyed, the subtree was a fresh MOUNT on every navigation
              and React shows a fallback for a mount even inside a transition: #main blanked
              for a frame on every click. Unkeyed it is an UPDATE — react-router-dom 7 wraps
              its state in startTransition — so the old page stays committed until the new
              chunk resolves. The retry stays real without the key: React.lazy memoizes the
              rejected import, so returning to the route that threw rethrows and the alert
              comes straight back, while resetKey clears the boundary on the way out.
              .route-fallback, not panels.css's .empty-note: panels.css reaches the entry
              chunk only INCIDENTALLY (the drawer imports it), and a fallback that leans on a
              neighbor's import staying put is one refactor from rendering unstyled. */}
          <Suspense fallback={<p className="route-fallback" role="status">Loading…</p>}>
            <RouteBoundary resetKey={pathname}>
              <Outlet />
            </RouteBoundary>
          </Suspense>
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
