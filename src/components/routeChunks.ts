import type { ComponentType } from 'react'

// Single source of truth for the lazy page modules: App.tsx's lazy() calls and the
// prefetch helpers below resolve the SAME thunk, so a prefetched path is by construction
// the module the router will mount — a hand-maintained duplicate would warm dead bytes
// the moment one side drifted. Login and the 404 are deliberately absent (eager in
// App.tsx: first paint must not wait on a chunk).
export type RouteChunk = () => Promise<{ default: ComponentType }>

export const ROUTE_CHUNKS: Record<string, RouteChunk> = {
  '/': () => import('../pages/OverviewPage'),
  '/update': () => import('../pages/MonthlyUpdatePage'),
  '/net-worth': () => import('../pages/NetWorthPage'),
  '/spending': () => import('../pages/SpendingPage'),
  '/portfolio': () => import('../pages/PortfolioPage'),
  '/credit-cards': () => import('../pages/CreditCardsPage'),
  '/taxes': () => import('../pages/TaxesPage'),
  '/espp': () => import('../pages/EsppPage'),
  '/paycheck': () => import('../pages/PaycheckPage'),
  '/comp': () => import('../pages/CompPage'),
  '/calendar': () => import('../pages/CalendarPage'),
  '/projection': () => import('../pages/ProjectionPage'),
  '/settings': () => import('../pages/SettingsPage'),
}

/** Warm one route's chunk (nav-link hover/focus). Fire-and-forget: a failed prefetch
 *  must stay silent — RouteBoundary's Reload is the real recovery path, and lazy()
 *  re-attempts the fetch on actual navigation. */
export function prefetchRoute(path: string, chunks: Record<string, RouteChunk> = ROUTE_CHUNKS): void {
  void chunks[path]?.().catch(() => {})
}

/** Warm every chunk during idle time, one per idle slot so the walk never competes with
 *  real work. Idempotent by construction — import() memoizes — so no module-level guard
 *  (which would leak order-dependence into tests). */
export function warmAllRoutes(chunks: Record<string, RouteChunk> = ROUTE_CHUNKS): void {
  const thunks = Object.values(chunks)
  // Safari has no requestIdleCallback; a short timeout is close enough for warming.
  const idle: (cb: () => void) => void =
    typeof requestIdleCallback === 'function'
      ? (cb) => {
          requestIdleCallback(() => cb())
        }
      : (cb) => {
          setTimeout(cb, 250)
        }
  const next = (i: number) => {
    if (i >= thunks.length) return
    void thunks[i]().catch(() => {})
    idle(() => next(i + 1))
  }
  idle(() => next(0))
}
