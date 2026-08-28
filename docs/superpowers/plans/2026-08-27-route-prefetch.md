# Route-Chunk Prefetch Implementation Plan (Batch Plan 2/6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route chunks are warmed before the user navigates — hover/focus on a sidebar link prefetches that page's chunk, and all chunks warm during idle time after first paint — so the Suspense `Loading…` fallback effectively never shows.

**Architecture:** One new module `src/components/routeChunks.ts` owns the 13 lazy-page import thunks as a single source of truth; `App.tsx`'s `lazy()` calls and the prefetch helpers consume the *same* thunks, so a prefetched path is by construction the module the router mounts. `Layout` wires nav-link `onMouseEnter`/`onFocus` to per-route prefetch and runs an idle warm-all once after mount. Prefetch failures are silent — `RouteBoundary` + Reload stays the only recovery path, and `lazy()` re-attempts the network fetch on real navigation anyway.

**Tech Stack:** React 19 `lazy`, Vite dynamic imports, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-27-navigation-ux-polish-design.md` §2.

**Conventions for this plan:**
- Run tests with `npx vitest run <file>` from the repo root (`C:\Users\edyli\personal-finance-dashboard`).
- Never push. Commit after each task exactly as written.
- Do not modify `LoginPage`/`NotFoundPage` imports in `App.tsx` — they are deliberately eager (first paint must not wait on a chunk).

---

### Task 1: `routeChunks.ts` — the thunk map + prefetch helpers

**Files:**
- Create: `src/components/routeChunks.ts`
- Create: `src/components/routeChunks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/routeChunks.test.ts` with exactly:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAV_SECTIONS } from './navItems'
import { prefetchRoute, ROUTE_CHUNKS, warmAllRoutes } from './routeChunks'
import type { RouteChunk } from './routeChunks'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ROUTE_CHUNKS', () => {
  it('covers every sidebar destination', () => {
    const paths = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.to))
    for (const path of paths) {
      expect(ROUTE_CHUNKS[path], `missing chunk for ${path}`).toBeDefined()
    }
  })

  it('has no chunk without a sidebar destination (map and nav stay in lockstep)', () => {
    const paths = new Set(NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.to)))
    for (const key of Object.keys(ROUTE_CHUNKS)) {
      expect(paths.has(key), `chunk ${key} has no sidebar destination`).toBe(true)
    }
  })
})

describe('prefetchRoute', () => {
  it('invokes the matching thunk once and ignores unknown paths', () => {
    const thunk = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = { '/x': thunk as unknown as RouteChunk }
    prefetchRoute('/x', chunks)
    prefetchRoute('/nope', chunks)
    expect(thunk).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected chunk fetch', async () => {
    const chunks: Record<string, RouteChunk> = {
      '/x': (() => Promise.reject(new Error('offline'))) as unknown as RouteChunk,
    }
    expect(() => prefetchRoute('/x', chunks)).not.toThrow()
    // Flush the microtask queue; an unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('warmAllRoutes', () => {
  it('walks every thunk via requestIdleCallback, one per idle slot', () => {
    const calls: string[] = []
    const mk = (name: string) =>
      (() => {
        calls.push(name)
        return Promise.resolve({ default: () => null })
      }) as unknown as RouteChunk
    const chunks: Record<string, RouteChunk> = { a: mk('a'), b: mk('b'), c: mk('c') }
    // Synchronous idle: each scheduled callback runs immediately.
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      cb()
      return 1
    })
    warmAllRoutes(chunks)
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('falls back to setTimeout when requestIdleCallback is missing (Safari)', () => {
    const thunk = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = { only: thunk as unknown as RouteChunk }
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    warmAllRoutes(chunks)
    expect(thunk).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(thunk).toHaveBeenCalledTimes(1)
  })

  it('swallows rejections while continuing the walk', async () => {
    const second = vi.fn(() => Promise.resolve({ default: () => null }))
    const chunks: Record<string, RouteChunk> = {
      bad: (() => Promise.reject(new Error('offline'))) as unknown as RouteChunk,
      good: second as unknown as RouteChunk,
    }
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      cb()
      return 1
    })
    warmAllRoutes(chunks)
    expect(second).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/routeChunks.test.ts`
Expected: FAIL — cannot resolve `./routeChunks`.

- [ ] **Step 3: Implement the module**

Create `src/components/routeChunks.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/routeChunks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/routeChunks.ts src/components/routeChunks.test.ts
git commit -m "feat(nav): route-chunk thunk map + prefetch helpers"
```

---

### Task 2: `App.tsx` consumes the shared thunks

**Files:**
- Modify: `src/App.tsx:10-24`

- [ ] **Step 1: Replace the thirteen inline import thunks**

In `src/App.tsx`, replace lines 10–24 (the comment plus the thirteen `lazy(() => import(...))` declarations) with:

```tsx
import { ROUTE_CHUNKS } from './components/routeChunks'

// Route-level splitting (Plans 3-5 deferred it here): echarts + each page leave the entry
// chunk; Login and the 404 stay eager (first paint must not wait on a chunk). The import
// thunks live in routeChunks.ts so hover/idle prefetch (Layout) resolves the SAME modules
// lazy() mounts.
const OverviewPage = lazy(ROUTE_CHUNKS['/'])
const MonthlyUpdatePage = lazy(ROUTE_CHUNKS['/update'])
const NetWorthPage = lazy(ROUTE_CHUNKS['/net-worth'])
const SpendingPage = lazy(ROUTE_CHUNKS['/spending'])
const PortfolioPage = lazy(ROUTE_CHUNKS['/portfolio'])
const CreditCardsPage = lazy(ROUTE_CHUNKS['/credit-cards'])
const TaxesPage = lazy(ROUTE_CHUNKS['/taxes'])
const EsppPage = lazy(ROUTE_CHUNKS['/espp'])
const PaycheckPage = lazy(ROUTE_CHUNKS['/paycheck'])
const CompPage = lazy(ROUTE_CHUNKS['/comp'])
const CalendarPage = lazy(ROUTE_CHUNKS['/calendar'])
const ProjectionPage = lazy(ROUTE_CHUNKS['/projection'])
const SettingsPage = lazy(ROUTE_CHUNKS['/settings'])
```

Keep the existing `import { lazy } from 'react'` and every other line of the file unchanged. Place the `ROUTE_CHUNKS` import with the other `./components/` imports (after the `ToastProvider` import).

- [ ] **Step 2: Type-check and build**

Run: `npx tsc -b && npx vite build`
Expected: clean type-check; the build output still lists a separate chunk per page (look for `OverviewPage-*.js`, `SpendingPage-*.js`, etc. in the emitted assets — the map must not have collapsed the split points).

- [ ] **Step 3: Run the full frontend suite (guards against route regressions)**

Run: `npx vitest run`
Expected: PASS — same count as on `main` before this plan.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(nav): App.tsx lazy() consumes the shared route-chunk thunks"
```

---

### Task 3: Layout wires hover/focus prefetch + idle warm-all

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/Layout.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/Layout.test.tsx`, add a module mock immediately after the existing `vi.mock('../contexts/AuthContext', …)` block (top level, before `renderShell`):

```tsx
vi.mock('./routeChunks', () => ({
  prefetchRoute: vi.fn(),
  warmAllRoutes: vi.fn(),
}))
```

Add the import (with the other imports at the top):

```tsx
import { prefetchRoute, warmAllRoutes } from './routeChunks'
```

Then add a new describe block at the end of the file:

```tsx
describe('Layout — route prefetch', () => {
  it('prefetches a destination chunk on hover and on keyboard focus', () => {
    renderShell()
    const link = screen.getByRole('link', { name: 'Spending' })
    fireEvent.mouseOver(link)
    expect(prefetchRoute).toHaveBeenCalledWith('/spending')
    fireEvent.focus(screen.getByRole('link', { name: 'Portfolio' }))
    expect(prefetchRoute).toHaveBeenCalledWith('/portfolio')
  })

  it('warms all chunks once after mount', () => {
    renderShell()
    expect(warmAllRoutes).toHaveBeenCalledTimes(1)
  })
})
```

Note: `vi.mock` factories are hoisted; `restoreAllMocks` in the file's `afterEach` does not
undo module mocks, but it DOES reset call history of `vi.fn()`s created in the factory? No —
`vi.restoreAllMocks` only restores spies created with `vi.spyOn`. Call counts on the factory
fns accumulate across tests in this file, so the `warmAllRoutes` assertion must be robust:
add `vi.mocked(warmAllRoutes).mockClear()` and `vi.mocked(prefetchRoute).mockClear()` inside
the existing `beforeEach` block (after the `scrollTo` spy line).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: FAIL — `prefetchRoute` not called (Layout does not import it yet).

- [ ] **Step 3: Implement in Layout**

In `src/components/Layout.tsx`:

1. Add the import after the `RouteBoundary` import:

```tsx
import { prefetchRoute, warmAllRoutes } from './routeChunks'
```

2. Add the warm-all effect directly after the existing navigation-reset `useEffect` (the one ending at line 27):

```tsx
  // Warm every route chunk during idle time so in-app navigation never waits on the
  // network for JS. Hover/focus prefetch below covers the pre-idle window. import()
  // memoizes, so re-mounts re-warm for free (no-ops).
  useEffect(() => {
    warmAllRoutes()
  }, [])
```

3. Change the `NavLink` render (currently lines 44–47) to:

```tsx
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
```

- [ ] **Step 4: Run the Layout tests**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: PASS — all pre-existing tests plus the two new ones.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx
git commit -m "feat(nav): hover/focus chunk prefetch + idle warm-all in Layout"
```

---

## Self-review checklist (run before handing back)

- [ ] `npx tsc -b` clean, `npx vitest run` fully green.
- [ ] `npx vite build` still emits one chunk per page (split not collapsed).
- [ ] `git log --oneline` shows the three commits above.
- [ ] No changes outside: `src/App.tsx`, `src/components/Layout.tsx`, `src/components/Layout.test.tsx`, `src/components/routeChunks.ts`, `src/components/routeChunks.test.ts`.
