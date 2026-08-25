# Polish Batch (Nine Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nine small, independent quality fixes that the 2026-08-25 audit surfaced, landed as one frontend batch: `color-scheme: dark` + a `--warn` token replacing six duplicated amber literals; a favicon + per-route document titles; a real 404 page; three login fixes (AA-safe primary button, `role="alert"`, autofocus); a skip link with focus/scroll reset on navigation; an `ariaLabel` facade on `EChart` applied to ten charts; sidebar v2 (grouped sections, sentence case, a real active state); a toast layer with instant-delete + Undo on the four low-risk delete flows; and a hand-rolled Ctrl+K command palette.

**Architecture:** Everything is frontend-only and additive. One new nav registry (`src/components/navItems.ts` — sections for the sidebar, a flat list for the title hook and the palette) so a page added once shows up in all three places. One new ambient context (`ToastProvider` — a single always-mounted `aria-live="polite"` region; `useToast()` returns a NO-OP outside the provider, deliberately inverting `useAuth`'s throw, so the ~70 pre-existing direct-render tests of the delete hosts keep passing untouched). Undo never patches state locally: it re-POSTs the captured row through the existing create function (a new id is acceptable by design) and refetches through the host's existing `onChanged`/`load`. The palette is a combobox-pattern overlay over the nav registry plus a four-entry action list, ranked by a hand-written subsequence scorer (`src/utils/fuzzy.ts`) with recently-used ids in localStorage. `EChart` gains exactly one optional prop; nothing in the component restructures.

**Tech Stack:** React 19 + TypeScript + Vite, react-router 7, lucide-react, hand-rolled CSS, Vitest + @testing-library/react (fireEvent, no jest-dom, no user-event). No new dependencies. No backend, no docker, no pytest.

**Spec:** `docs/superpowers/specs/2026-08-25-five-feature-batch-design.md` §4 ("Polish batch — nine items") is binding, plus its Decision-log row "Polish batch scope" (all nine items, including toast+undo and the palette) and the Cross-cutting section (TDD; no schema work; out-of-scope list). Cite the spec for any ambiguity.

**Overnight protocol:** work happens in the git worktree `.worktrees/polish-batch` on branch `polish-batch` (the orchestrator creates the worktree and the branch; Task 0 verifies a clean `git status`, the branch name, runs `npm ci` in the worktree — expected: completes without error — and a smoke `npx vitest run src/utils/months.test.ts`). ALL commands below run from the worktree root. FRONTEND ONLY: no backend commands, no docker, no pytest. No file deletions (unused files stay — `PlaceholderPage.tsx` in particular remains on disk unimported; imports may be removed). Never push. Frequent small commits.

**House rules that bind every task:** focus-before-reset on save-success paths (untouched here, but every delete-flow edit must preserve the hosts' existing focus/reset order); comments explain constraints, not narration; server sentences render verbatim (`ApiError.message` straight into alerts/banners — never rewritten).

**Cross-plan note:** a sibling plan (chart-affordances) adds a DIFFERENT optional prop (`exportConfig`) to `src/components/EChart.tsx` on a parallel branch. Implement ONLY `ariaLabel` here, purely additively — one new prop in the signature, two new attributes on the container div, nothing else in the component moves — so the orchestrator can merge both branches without conflict surgery.

---

## File structure

| File | Responsibility |
|---|---|
| `src/index.css` | `color-scheme: dark` + the `--warn` custom property |
| `src/pages/OverviewPage.css`, `src/pages/MonthlyUpdatePage.css`, `src/pages/EsppPage.css`, `src/pages/PortfolioPage.css`, `src/components/portfolio/portfolio.css` | `#c98500` → `var(--warn)` (six occurrences) |
| `public/favicon.svg` (create), `index.html` | The mark + its `<link rel="icon">` |
| `src/components/navItems.ts` (create) | Nav registry: `NAV_SECTIONS` (sidebar) + flat `NAV_ITEMS` (title hook, palette) |
| `src/components/usePageTitle.ts` (create) + `usePageTitle.test.tsx` | `document.title = "{label} · Finance"`, fallback `"Finance Dashboard"` |
| `src/components/Layout.tsx`, `src/components/Layout.css` + `Layout.test.tsx` (create) | Sidebar v2, skip link, `<main id="main">` focus/scroll reset, title hook + palette mounts |
| `src/pages/NotFoundPage.tsx` (create) + `NotFoundPage.test.tsx`, `src/App.tsx` | Real 404 on the `.page` scaffolding; catch-all swap; `ToastProvider` mount |
| `src/pages/LoginPage.tsx`, `src/pages/LoginPage.css` + `LoginPage.test.tsx` (create) | `.button-primary`, `role="alert"`, `autoFocus` |
| `src/components/EChart.tsx` + `EChart.test.tsx` (create) | Optional `ariaLabel` → `role="img"` + `aria-label` |
| `src/pages/OverviewPage.tsx`, `src/pages/ProjectionPage.tsx`, `src/pages/SpendingPage.tsx`, `src/pages/PaycheckPage.tsx`, `src/components/portfolio/AllocationPanel.tsx` | The ten label applications |
| `src/pages/SpendingPage.test.tsx`, `src/pages/PaycheckPage.test.tsx` | Mock pass-through + page-level label pins |
| `src/components/ToastProvider.tsx`, `src/components/toast.css` (create) + `ToastProvider.test.tsx` | Context + `useToast()`, polite region, variants, auto-dismiss/pause, actions |
| `src/components/portfolio/TransactionsPanel.tsx` + test | Instant delete + Undo (re-create via `createTransaction`) |
| `src/components/portfolio/DividendsPanel.tsx` + test | Instant delete + Undo (re-create via `createDividend`) |
| `src/pages/CalendarPage.tsx` + `CalendarPage.test.tsx` | Delete toast + Undo (re-create via `createCustomEvent`; already confirm-free) |
| `src/components/comp/RsuGrantsPanel.tsx`, `src/pages/CompPage.test.tsx` | Instant delete + Undo (re-create via `createRsuGrant`) |
| `src/utils/fuzzy.ts` (create) + `fuzzy.test.ts` | Subsequence scorer (no library) |
| `src/components/CommandPalette.tsx`, `src/components/CommandPalette.css` (create) + `CommandPalette.test.tsx` | Ctrl/Cmd+K overlay: fuzzy nav + actions, recents, combobox ARIA, focus trap |
| `src/pages/PlaceholderPage.tsx` | STAYS on disk, loses its last importer (App.tsx) — verified by grep, never deleted |

---

## Phase 0 — Environment & branch verification

### Task 0: Verify the worktree the orchestrator prepared

**Files:** none (environment only)

- [x] **Step 1: Confirm the worktree, the branch and a clean tree** (run from `.worktrees/polish-batch`):

```bash
git status --porcelain   # expected: EMPTY output
git rev-parse --abbrev-ref HEAD   # expected: polish-batch
```

If the branch is wrong or the tree is dirty, STOP and report — do not "fix" it by switching or stashing; the orchestrator owns branch setup.

- [x] **Step 2: Install** — `npm ci` → expected: completes without error (the worktree has its own `node_modules`).

- [x] **Step 3: Frontend smoke** — `npx vitest run src/utils/months.test.ts` → PASS.

---

## Phase 1 — Theme, shell & chrome

### Task 1: `color-scheme: dark` + the `--warn` token

**Files:**
- Modify: `src/index.css`, `src/pages/OverviewPage.css`, `src/pages/MonthlyUpdatePage.css`, `src/pages/EsppPage.css`, `src/pages/PortfolioPage.css`, `src/components/portfolio/portfolio.css`

No unit test carries CSS custom properties — the pin is the grep in Step 3 plus the suite staying green.

- [x] **Step 1: index.css.** Replace the `:root` block (currently lines 1–12) with:

```css
:root {
  /* Native widgets (date pickers, scrollbars, form autofill) follow the app's darkness
     instead of flashing white chrome into it. */
  color-scheme: dark;
  --bg: #0f1115;
  --surface: #171a21;
  --surface-2: #1e222c;
  --border: #262b36;
  --text: #e6e9ef;
  --muted: #8b93a3;
  --accent: #4f8cff;
  --positive: #3fb968;
  --negative: #e05252;
  /* PALETTE[3] amber — the app's advisory/staleness register, promoted from six
     duplicated per-sheet literals (2026-08-25 polish §1). The CANVAS copies stay
     literal (charts/theme.ts PALETTE[3] and everything derived from it): a CSS custom
     property cannot reach an ECharts canvas. */
  --warn: #c98500;
  font-family: system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
```

- [x] **Step 2: The six literal swaps** (each is exact-string; the comment amendments keep the "comments explain constraints" rule honest — the old comments justified a literal that no longer exists):
  1. `src/pages/OverviewPage.css` line 37: `border-left: 3px solid #c98500;` → `border-left: 3px solid var(--warn);`. In the comment above it (lines 22–24), change the clause `the same PALETTE[3] literal the freshness cue below uses, for the same frozen-charts reason` → `the --warn token (PALETTE[3] amber) the freshness cue below shares`.
  2. `src/pages/OverviewPage.css` lines 96–100: replace the comment + rule pair with:

```css
/* --warn (PALETTE[3] amber): index.css owns the token now; only the canvas copy in
   charts/theme.ts stays a literal (CSS variables do not reach ECharts). */
.overview-freshness .stale {
  color: var(--warn);
}
```

  3. `src/pages/MonthlyUpdatePage.css` line 175: `border-left: 3px solid #c98500;` → `border-left: 3px solid var(--warn);`, and in the comment directly above the `.draft-note` block change the clause `annotation/advisory color (portfolio.css's staleness note explains why it's a literal)` → `annotation/advisory color (--warn, PALETTE[3] amber)`.
  4. `src/pages/EsppPage.css` line 119: `color: #c98500;` → `color: var(--warn);`.
  5. `src/pages/PortfolioPage.css` line 23: `border-left: 3px solid #c98500;` → `border-left: 3px solid var(--warn);` (the comment above already says "the staleness literal, PALETTE[3]" — change `the staleness literal, PALETTE[3]` → `--warn, PALETTE[3] amber`).
  6. `src/components/portfolio/portfolio.css` lines 34 and 43: both `#c98500` → `var(--warn)`; in the header comment (line 6–7), change `Colors come from the index.css :root variables wherever one exists; the remaining literal (#c98500) is theme.ts PALETTE[3], which has none.` → `Colors come from the index.css :root variables — including --warn (PALETTE[3] amber), which index.css defines since the 2026-08-25 polish.`

- [x] **Step 3: Verify the sweep** — `grep -rn "c98500" src` → expected EXACTLY three hits: `src/index.css` (the token definition), `src/charts/theme.ts` (PALETTE[3], the frozen canvas copy), `src/components/calendar/calendarView.test.ts` (a fixture pinning the PALETTE-derived `ex_dividend` color — TS, not CSS, stays). Any other hit means a missed swap.

- [x] **Step 4: Suite sanity** — `npx vitest run src/components/calendar/calendarView.test.ts` → PASS (the pinned literal was never touched).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(polish): color-scheme dark + --warn token for the amber literals"`

### Task 2: Favicon + nav registry + `usePageTitle`

**Files:**
- Create: `public/favicon.svg`, `src/components/navItems.ts`, `src/components/usePageTitle.ts`
- Modify: `index.html`
- Test: `src/components/usePageTitle.test.tsx` (create)

The hook ships here with its own test; Layout APPLIES it in Task 3 (an exported-but-unimported module compiles and lints clean in the interim).

- [x] **Step 1: Write the failing hook test** — create `src/components/usePageTitle.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { usePageTitle } from './usePageTitle'

// The hook is pure routing→document.title; a null-rendering probe is its whole harness.
function Probe() {
  usePageTitle()
  return null
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  )

afterEach(cleanup)

describe('usePageTitle', () => {
  it('titles a known destination "{label} · Finance"', () => {
    renderAt('/net-worth')
    expect(document.title).toBe('Net worth · Finance')
  })

  it('matches the root exactly, never as a prefix', () => {
    renderAt('/')
    expect(document.title).toBe('Overview · Finance')
  })

  it('titles a sub-path by its owning section', () => {
    renderAt('/portfolio/anything')
    expect(document.title).toBe('Portfolio · Finance')
  })

  it('falls back for an unknown path (the 404)', () => {
    renderAt('/no-such-page')
    expect(document.title).toBe('Finance Dashboard')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/usePageTitle.test.tsx` → FAIL (cannot resolve `./usePageTitle`).

- [x] **Step 3: The nav registry** — create `src/components/navItems.ts`:

```ts
import {
  Banknote,
  Briefcase,
  CalendarCheck,
  CalendarDays,
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
    items: [
      { to: '/net-worth', label: 'Net worth', icon: TrendingUp },
      { to: '/spending', label: 'Spending', icon: Wallet },
      { to: '/portfolio', label: 'Portfolio', icon: LineChart },
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
```

- [x] **Step 4: The hook** — create `src/components/usePageTitle.ts`:

```ts
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './navItems'

/**
 * "{nav label} · Finance" from whichever destination owns the pathname; the fallback
 * covers unknowns (the 404). Root matches exactly — every other item also claims its
 * sub-paths, so a future /portfolio/... drill-in keeps its section's title.
 */
export function usePageTitle(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const item = NAV_ITEMS.find((candidate) =>
      candidate.to === '/'
        ? pathname === '/'
        : pathname === candidate.to || pathname.startsWith(`${candidate.to}/`),
    )
    document.title = item === undefined ? 'Finance Dashboard' : `${item.label} · Finance`
  }, [pathname])
}
```

- [x] **Step 5: Run** — `npx vitest run src/components/usePageTitle.test.tsx` → PASS.

- [x] **Step 6: The favicon** — create `public/favicon.svg` (the `public/` directory does not exist yet — creating the file creates it; Vite serves `public/` at the site root):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- The app's own tokens, hard-coded (an SVG file cannot read CSS custom properties
       from the page): --surface #171a21 tile, --border #262b36 edge, --accent #4f8cff
       line, --positive #3fb968 endpoint. Dark tile, so it reads on light AND dark
       browser chrome. -->
  <rect x="1" y="1" width="30" height="30" rx="7" fill="#171a21" stroke="#262b36" stroke-width="1"/>
  <path d="M7 21.5 L13 15 L17.5 18.5 L25 9.5" fill="none" stroke="#4f8cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="25" cy="9.5" r="2.2" fill="#3fb968"/>
</svg>
```

- [x] **Step 7: Link it** — in `index.html`, insert between the robots meta and the title:

```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

(The static `<title>Finance Dashboard</title>` stays — it is the pre-hydration and 404-fallback title, the same string the hook falls back to.)

- [x] **Step 8: Commit** — `git add -A && git commit -m "feat(polish): favicon, nav registry, usePageTitle hook"`

### Task 3: Sidebar v2 + skip link + navigation focus/scroll reset

**Files:**
- Modify: `src/components/Layout.tsx`, `src/components/Layout.css`
- Test: `src/components/Layout.test.tsx` (create)

- [x] **Step 1: Write the failing tests** — create `src/components/Layout.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'

// Layout only reads logout off the context; session plumbing is AuthContext.test's job.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'me@example.com',
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}))

function renderShell(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>home body</div>} />
          <Route path="/spending" element={<div>spending body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // jsdom's scrollTo is a not-implemented stub that logs to the console; the reset
  // assertion wants a spy anyway.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Layout — sidebar v2', () => {
  it('groups the destinations under uppercase headers, sentence-cased, in order', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByText('Tracking')).toBeTruthy()
    expect(within(nav).getByText('Income')).toBeTruthy()
    expect(within(nav).getByText('Planning')).toBeTruthy()
    // The full order IS the contract: ungrouped pair, three groups, Settings last.
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Overview',
      'Monthly update',
      'Net worth',
      'Spending',
      'Portfolio',
      'Paycheck',
      'Comp',
      'ESPP',
      'Taxes',
      'Projection',
      'Calendar',
      'Settings',
    ])
    // The separator sits between Settings and Log out.
    expect(document.querySelector('.sidebar-separator')).not.toBeNull()
    expect(screen.getByRole('button', { name: /log out/i })).toBeTruthy()
  })

  it('marks the current page with aria-current and the active class — root matches exactly', () => {
    renderShell('/spending')
    const active = screen.getByRole('link', { name: 'Spending' })
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(active.className).toContain('active')
    expect(
      screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('titles the document from the active destination', () => {
    renderShell()
    expect(document.title).toBe('Overview · Finance')
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    expect(document.title).toBe('Spending · Finance')
  })
})

describe('Layout — skip link and navigation reset', () => {
  it('renders the skip link first, aimed at the focusable main', () => {
    renderShell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip.getAttribute('href')).toBe('#main')
    expect(document.querySelector('.layout')?.firstElementChild).toBe(skip)
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('focuses main and scrolls to top on navigation — never on arrival', () => {
    renderShell()
    // Arrival: the browser's own focus/scroll stand.
    expect(document.activeElement).toBe(document.body)
    expect(window.scrollTo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    expect(screen.getByText('spending body')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/Layout.test.tsx` → FAIL (no "Primary" nav, no skip link, "Net Worth" casing, no title).

- [x] **Step 3: Rewrite `src/components/Layout.tsx`** — full replacement (the RouteBoundary comment block is the existing one, kept verbatim):

```tsx
import { LogOut } from 'lucide-react'
import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
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
```

(The old in-file `NAV_ITEMS` const is gone — the registry moved to `navItems.ts` in Task 2. Icon imports shrink to `LogOut` alone.)

- [x] **Step 4: Layout.css.** Three edits:
  1. Replace the `.sidebar nav` rule with the section trio:

```css
.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 0.45rem; /* between sections; the old 2px per-link rhythm lives inside them */
  flex: 1;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-heading {
  margin: 0.35rem 0 0.1rem;
  padding: 0 0.75rem;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
```

  2. Replace the `.nav-link.active` rule (hover stays as-is — the two are DIFFERENT statements now: hover is "you are pointing here", active is "you are here"):

```css
/* Active ≠ hover: a 3px accent inset + accent icon on top of the hover surface, so the
   current page stays legible even under the pointer. */
.nav-link.active {
  background: var(--surface-2);
  color: var(--text);
  box-shadow: inset 3px 0 0 var(--accent);
}

.nav-link.active svg {
  color: var(--accent);
}
```

  3. Append at the end of the file:

```css
/* The separator between Settings and Log out (2026-08-25 polish §7). */
.sidebar-separator {
  border-top: 1px solid var(--border);
  margin: 0.5rem 0.25rem;
}

/* Skip link (polish §5): parked above the viewport until keyboard focus arrives. */
.skip-link {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 15;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  background: var(--accent);
  color: #0b0e14;
  font-weight: 600;
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: none;
}

/* Programmatic focus target (the skip link + the navigation hand-off) — never a visible
   ring: the whole page lighting up on every navigation would be noise, and main is not
   in the tab order. */
.content:focus {
  outline: none;
}
```

- [x] **Step 5: Run** — `npx vitest run src/components/Layout.test.tsx` → PASS.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(polish): sidebar v2, skip link, navigation focus/scroll reset"`

### Task 4: Real 404

**Files:**
- Create: `src/pages/NotFoundPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/pages/NotFoundPage.test.tsx` (create)

- [x] **Step 1: Write the failing test** — create `src/pages/NotFoundPage.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import NotFoundPage from './NotFoundPage'

afterEach(cleanup)

describe('NotFoundPage', () => {
  it('names the missing path and links home', () => {
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('No page at /no-such-page.')).toBeTruthy()
    const home = screen.getByRole('link', { name: 'Back to the overview →' })
    expect(home.getAttribute('href')).toBe('/')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/NotFoundPage.test.tsx` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/pages/NotFoundPage.tsx`:

```tsx
import { Link, useLocation } from 'react-router-dom'
import '../components/panels.css'

// The real 404 (2026-08-25 polish §3): names the path that missed and offers the one
// useful move. Eager beside Login in App.tsx — an error surface must not wait on a chunk.
export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="page">
      <header className="page-header">
        <h1>Not found</h1>
      </header>
      <p className="empty-note">
        <span>No page at {pathname}.</span> <Link to="/">Back to the overview →</Link>
      </p>
    </div>
  )
}
```

- [x] **Step 4: Swap the catch-all.** In `src/App.tsx`:
  1. Replace `import PlaceholderPage from './pages/PlaceholderPage'` with `import NotFoundPage from './pages/NotFoundPage'`.
  2. In the comment above the lazy block, change `Login and the 404 placeholder stay eager` → `Login and the 404 stay eager`.
  3. Replace `<Route path="*" element={<PlaceholderPage title="Not Found" />} />` with `<Route path="*" element={<NotFoundPage />} />`.

- [x] **Step 5: Prove the placeholder is orphaned, not deleted** — `grep -rln "PlaceholderPage" src` → expected EXACTLY `src/pages/PlaceholderPage.tsx` (its own definition; zero importers). The file STAYS on disk — no deletions overnight.

- [x] **Step 6: Run** — `npx vitest run src/pages/NotFoundPage.test.tsx` → PASS.

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(polish): real 404 page, placeholder orphaned"`

### Task 5: Login fixes — primary button, alert role, autofocus

**Files:**
- Modify: `src/pages/LoginPage.tsx`, `src/pages/LoginPage.css`, `src/components/Layout.tsx` (one comment clause)
- Test: `src/pages/LoginPage.test.tsx` (create)

- [x] **Step 1: Write the failing tests** — create `src/pages/LoginPage.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { AuthProvider } from '../contexts/AuthContext'
import LoginPage from './LoginPage'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}))
import { login } from '../api/auth'

// The real AuthProvider: with no stored token it resolves tokenless synchronously, so
// the form renders at once and login() above is the only wire this file touches.
function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LoginPage', () => {
  it('focuses the email box on arrival', () => {
    renderPage()
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  })

  it('announces a failed login as an alert, server sentence verbatim', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError('Invalid email or password', 401))
    renderPage()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Invalid email or password')
  })

  it('submits through the shared primary button classes', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toBe(
      'button button-primary',
    )
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/LoginPage.test.tsx` → FAIL (no autofocus, no alert role, bare button class).

- [x] **Step 3: LoginPage.tsx.** Three edits:
  1. Add `import '../components/panels.css'` on the line ABOVE `import './LoginPage.css'` (the login screen needs `.button-primary`; panels.css thereby joins the eager entry chunk — see Step 5).
  2. The email input gains `autoFocus` (first attribute line, above `type="email"`).
  3. The error div and the button become:

```tsx
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="button button-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
```

- [x] **Step 4: LoginPage.css.** Replace the two button blocks (`.login-card button` and `.login-card button:disabled`) with:

```css
/* Layout-only: the primary treatment (dark-on-accent — AA-safe, unlike the old local
   white-on-accent at ~3.2:1, 2026-08-25 polish §4) comes from panels.css's
   .button-primary. This selector outranks the class rules per-property, so it must not
   re-declare background or color. */
.login-card button {
  padding: 0.6rem;
  border: none;
  border-radius: 6px;
  justify-content: center; /* .button is inline-flex; a stretched column child centers its label */
  cursor: pointer;
}

.login-card button:disabled {
  opacity: 0.6;
}
```

- [x] **Step 5: Keep the two stale comments honest.** Login (eager) importing panels.css moves that sheet into the entry chunk, which dates two claims:
  1. `src/components/Layout.tsx` — in the RouteBoundary comment, change the clause `panels.css now ships with the first PAGE chunk, so it is absent from the very paint this fallback owns.` → `panels.css travels with its importers, not this file, so this fallback cannot rely on it.`
  2. `src/components/Layout.css` — in the `.route-fallback` comment, change `not panels.css, which now arrives lazily with the first page chunk (Task 9 review)` → `not panels.css, which travels with its importers (Task 9 review; Login pulls it eagerly since the 2026-08-25 polish)`.

- [x] **Step 6: Run** — `npx vitest run src/pages/LoginPage.test.tsx src/components/Layout.test.tsx` → PASS.

- [x] **Step 7: Commit** — `git add -A && git commit -m "fix(login): primary-button contrast, error alert role, email autofocus"`

---

## Phase 2 — Chart aria

### Task 6: `EChart` gains `ariaLabel`

**Files:**
- Modify: `src/components/EChart.tsx`
- Test: `src/components/EChart.test.tsx` (create)

- [x] **Step 1: Write the failing test** — create `src/components/EChart.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// House law keeps real echarts out of jsdom (no canvas). The component's DOM facade —
// the aria contract this batch adds — is testable with the ENGINE stubbed at the module
// boundary; the stub offers exactly what EChart's effects call.
vi.mock('../charts/echarts', () => ({
  echarts: {
    init: vi.fn(() => ({
      on: vi.fn(),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}))
import EChart from './EChart'

beforeAll(() => {
  // jsdom has no ResizeObserver; EChart observes its container on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(cleanup)

describe('EChart aria facade', () => {
  it('renders role="img" + the label when ariaLabel is given', () => {
    const { container } = render(
      <EChart option={{}} ariaLabel="Line chart of net worth at every monthly snapshot" />,
    )
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBe('img')
    expect(div.getAttribute('aria-label')).toBe(
      'Line chart of net worth at every monthly snapshot',
    )
  })

  it('renders NO role and no label when the prop is absent', () => {
    const { container } = render(<EChart option={{}} />)
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBeNull()
    expect(div.getAttribute('aria-label')).toBeNull()
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/EChart.test.tsx` → FAIL (TS: no `ariaLabel` prop; no role rendered).

- [x] **Step 3: Implement — purely additively** (cross-plan note: a sibling branch adds `exportConfig` to this same signature; touch NOTHING but the prop and the two attributes). In `src/components/EChart.tsx`, the destructure + type gain one entry after `height = 320,` / `height?: number`:

```tsx
  ariaLabel,
```

```tsx
  // A one-sentence description of what the chart SHOWS (deliberate house wording —
  // ECharts' generated aria is not used; spec §4 item 6). Optional and additive: a
  // sibling plan adds its own optional prop on a parallel branch, so this signature
  // only ever GROWS entries.
  ariaLabel?: string
```

and the return statement becomes:

```tsx
  return (
    <div
      ref={containerRef}
      // role only WITH a label: a bare role="img" would be an unnamed image to a screen
      // reader — worse than the default (skippable) div.
      role={ariaLabel === undefined ? undefined : 'img'}
      aria-label={ariaLabel}
      style={{ height, width: '100%' }}
    />
  )
```

- [x] **Step 4: Run** — `npx vitest run src/components/EChart.test.tsx` → PASS. Then `npx vitest run src/components` → PASS (every panel test that mocks EChart is untouched by an optional prop).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): EChart optional ariaLabel -> role=img facade"`

### Task 7: Apply the ten labels

**Files:**
- Modify: `src/pages/OverviewPage.tsx`, `src/pages/ProjectionPage.tsx`, `src/pages/SpendingPage.tsx`, `src/pages/PaycheckPage.tsx`, `src/components/portfolio/AllocationPanel.tsx`
- Test: `src/pages/SpendingPage.test.tsx`, `src/pages/PaycheckPage.test.tsx` (page-level pins; EChart.test.tsx already pins the mechanism)

- [x] **Step 1: Write the failing page pins.** In `src/pages/SpendingPage.test.tsx`, extend the EChart mock to pass the label through — the mock's destructure and props type each gain `ariaLabel` and the created div gains the attribute:

```tsx
    default: ({
      option,
      onClick,
      ariaLabel,
    }: {
      option: {
        series?: { links?: { source?: string; target?: string; value?: number }[] }[]
      }
      onClick?: (params: { dataIndex?: number }) => void
      ariaLabel?: string
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-links': (option.series?.[0]?.links ?? [])
          .map((l) => `${l.source}>${l.target}=${l.value}`)
          .join('|'),
        onClick: () => onClick?.({ dataIndex: 0 }),
      }),
```

  then append a new describe at the end of the file:

```tsx
describe('SpendingPage — chart aria', () => {
  it('names the heatmap and the sankey for assistive tech', async () => {
    renderPage()
    await screen.findByText('Where Jul 2026 went')
    expect(
      document.querySelector(
        '[aria-label="Heatmap of spend per category per month — darker is more"]',
      ),
    ).not.toBeNull()
    expect(
      document.querySelector(
        '[aria-label="Sankey flow of where Jul 2026 went, from net pay into categories and savings"]',
      ),
    ).not.toBeNull()
  })
})
```

  In `src/pages/PaycheckPage.test.tsx`, give its EChart mock the same treatment (add `ariaLabel` to the destructure, `ariaLabel?: string` to the props type, `'aria-label': ariaLabel` to the created div) and append inside the existing `describe('PaycheckPage — the flow card', …)`:

```tsx
  it('names the sankey for assistive tech', async () => {
    render(<PaycheckPage />)
    await screen.findByText('Where each check goes')
    expect(
      document.querySelector('[aria-label="Sankey flow of one paycheck from gross to net"]'),
    ).not.toBeNull()
  })
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/SpendingPage.test.tsx src/pages/PaycheckPage.test.tsx` → the two new tests FAIL (no labels yet); everything else PASSES.

- [x] **Step 3: Apply all ten labels.** Each is one attribute added to an existing `<EChart …/>` mount — nothing else on the mount changes. Dynamic where cheap (a value already narrowed in the branch), static otherwise.

  1. `src/pages/OverviewPage.tsx` — the three mounts become:

```tsx
                <EChart option={spark} height={220} ariaLabel="Line chart of net worth at every monthly snapshot" />
```
```tsx
                <EChart option={perf} height={280} ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly" />
```
```tsx
                <EChart option={bars} height={240} ariaLabel="Bar chart of total spending for each of the last 12 entered months" />
```

  2. `src/pages/ProjectionPage.tsx` — both charts (both sit inside the `data && (…)` branch, so `data` is narrowed):

```tsx
                  <EChart
                    option={nwChart}
                    height={340}
                    ariaLabel={`Net worth history with a fitted trend extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} forward, on a log scale`}
                  />
```
```tsx
                <EChart
                  option={chart}
                  height={340}
                  ariaLabel={`Projected investable balance over the next ${data.years} years`}
                />
```

  3. `src/pages/SpendingPage.tsx` — the heatmap mount gains the static line below; the flow mount (inside the `flowPeriod && …` branch, so `flowPeriod` is narrowed) gains the dynamic one:

```tsx
              ariaLabel="Heatmap of spend per category per month — darker is more"
```
```tsx
                  ariaLabel={`Sankey flow of where ${flowPeriod.label} went, from net pay into categories and savings`}
```

  4. `src/pages/PaycheckPage.tsx` — FlowPanel's mount:

```tsx
          <EChart option={option} height={320} ariaLabel="Sankey flow of one paycheck from gross to net" />
```

  5. `src/components/portfolio/AllocationPanel.tsx` — the treemap mount gains the static line; the donut the dynamic one:

```tsx
          ariaLabel="Treemap of holdings by industry, sized and shaded by market value"
```
```tsx
            ariaLabel={`Donut chart of portfolio share by ${donutDim === 'type' ? 'holding type' : 'account'}`}
```

  (The bar/pie/savings/trend charts on Spending and the rest of the app may opt in later — spec §4 item 6 names this exact minimum set.)

- [x] **Step 4: Run** — `npx vitest run src/pages/SpendingPage.test.tsx src/pages/PaycheckPage.test.tsx src/pages/OverviewPage.test.tsx src/pages/ProjectionPage.test.tsx` → ALL PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(charts): aria labels on overview, projection, spending, paycheck, allocation charts"`

---

## Phase 3 — Toast + undo

### Task 8: `ToastProvider` — context, polite region, lifecycle

**Files:**
- Create: `src/components/ToastProvider.tsx`, `src/components/toast.css`
- Modify: `src/App.tsx`
- Test: `src/components/ToastProvider.test.tsx` (create)

- [x] **Step 1: Write the failing tests** — create `src/components/ToastProvider.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastProvider, { useToast } from './ToastProvider'

function Host({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast()
  return (
    <>
      <button
        onClick={() =>
          toast.success(
            'Deleted the NVDA buy',
            onUndo === undefined ? undefined : { action: { label: 'Undo', onAction: onUndo } },
          )
        }
      >
        fire success
      </button>
      <button onClick={() => toast.error('Save failed')}>fire error</button>
    </>
  )
}

function renderHost(onUndo?: () => void) {
  return render(
    <ToastProvider>
      <Host onUndo={onUndo} />
    </ToastProvider>,
  )
}

const region = () => document.querySelector('.toast-region') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('mounts the polite region BEFORE any toast fires, and toasts land inside it', () => {
    renderHost()
    expect(region().getAttribute('aria-live')).toBe('polite')
    expect(region().textContent).toBe('')
    fireEvent.click(screen.getByText('fire success'))
    expect(region().textContent).toContain('Deleted the NVDA buy')
    expect(region().querySelector('.toast')?.className).toContain('toast-success')
  })

  it('auto-dismisses after ~6s', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  // mouseOver/mouseOut, NOT mouseEnter/mouseLeave: React synthesizes onMouseEnter and
  // onMouseLeave from native mouseover/mouseout pairs (the EnterLeave plugin), so a
  // fired native "mouseenter" never reaches the handler. relatedTarget defaults to null,
  // which React reads as entering-from/leaving-to outside — exactly the hover contract.
  it('pauses on hover and re-arms a FULL window on leave', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.mouseOver(region())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    fireEvent.mouseOut(region())
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('a toast born under the pointer waits for it to leave', () => {
    renderHost()
    fireEvent.mouseOver(region())
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    fireEvent.mouseOut(region())
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('runs the action once and consumes the toast', () => {
    const onUndo = vi.fn()
    renderHost(onUndo)
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('carries the error variant and a manual dismiss', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire error'))
    expect(document.querySelector('.toast-error')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Save failed')).toBeNull()
  })

  it('useToast outside a provider is a silent no-op (the test-compat posture)', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('fire success'))
    expect(document.querySelector('.toast')).toBeNull()
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/ToastProvider.test.tsx` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/components/ToastProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './toast.css'

export interface ToastAction {
  label: string
  onAction: () => void
}

export interface ToastOptions {
  action?: ToastAction
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

type ToastVariant = 'success' | 'info' | 'error'

interface ToastEntry {
  id: number
  variant: ToastVariant
  message: string
  action?: ToastAction
}

// Long enough to read and reach Undo, short enough never to queue up (hover pauses it).
const AUTO_DISMISS_MS = 6000

// The deliberate INVERSE of useAuth's throw: toasts are an ambient layer, and a host
// rendered without it — every pre-existing direct-render test of the four delete hosts —
// must keep working. The notification is dropped; the operation never is.
const NOOP: ToastApi = { success: () => {}, info: () => {}, error: () => {} }

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const paused = useRef(false)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const arm = useCallback(
    (id: number) => {
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      )
    },
    [dismiss],
  )

  // A STABLE api object: it travels through context, and every consumer is a whole page —
  // a fresh identity per render would re-render them all whenever a toast comes or goes.
  const api = useMemo<ToastApi>(() => {
    const push =
      (variant: ToastVariant) =>
      (message: string, options?: ToastOptions) => {
        const id = nextId.current
        nextId.current += 1
        setToasts((current) => [...current, { id, variant, message, action: options?.action }])
        // Born under the pointer = not armed yet; resume() below re-arms every survivor.
        if (!paused.current) arm(id)
      }
    return { success: push('success'), info: push('info'), error: push('error') }
  }, [arm])

  // Pause on hover/focus; resume re-arms a FULL window rather than a remainder —
  // "I was reading this" earns a fresh clock, and no per-toast stopwatch bookkeeping.
  const pause = () => {
    paused.current = true
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }

  const resume = () => {
    paused.current = false
    for (const toast of toasts) arm(toast.id)
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted: a live region must exist BEFORE content lands, or screen
          readers miss the first announcement. */}
      <div
        className="toast-region"
        aria-live="polite"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
      >
        {toasts.map((toast) => {
          const action = toast.action
          return (
            <div key={toast.id} className={`toast toast-${toast.variant}`}>
              <span className="toast-message">{toast.message}</span>
              {action !== undefined && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    // Consume FIRST: an action that itself toasts (an undo that fails)
                    // must not race a dismiss aimed at the wrong entry.
                    dismiss(toast.id)
                    action.onAction()
                  }}
                >
                  {action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
```

- [x] **Step 4: CSS** — create `src/components/toast.css`:

```css
/* Toasts (2026-08-25 polish §8): one polite live region, bottom-right. z-index above the
   app's bubble layer (2) and the palette overlay (20) — an Undo affordance is never
   buried under the thing that spawned it. */

.toast-region {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 8px;
  color: var(--text);
  font-size: 0.85rem;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}

/* Variant rides the left edge — the app's advisory-strip grammar, not a full repaint. */
.toast-success { border-left-color: var(--positive); }
.toast-info { border-left-color: var(--accent); }
.toast-error { border-left-color: var(--negative); }

.toast-message {
  flex: 1;
}

.toast-action {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--accent);
  font: inherit;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
}

.toast-action:hover {
  border-color: var(--accent);
}

.toast-close {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0.1rem 0.2rem;
  cursor: pointer;
}

.toast-close:hover {
  color: var(--text);
}

.toast-action:focus-visible,
.toast-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
```

- [x] **Step 5: Mount in App above Layout.** In `src/App.tsx`, add `import ToastProvider from './components/ToastProvider'` (after the Layout import), then wrap the existing `<BrowserRouter>…</BrowserRouter>` element — every line of it byte-identical — in `<ToastProvider>` / `</ToastProvider>`, directly inside `<AuthProvider>`, and re-indent the wrapped block one level. Nothing inside the router changes. (Outside the router on purpose: toasts never navigate — the undo actions call API creates and the hosts' own refetchers.)

- [x] **Step 6: Run** — `npx vitest run src/components/ToastProvider.test.tsx` → PASS.

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(toast): ToastProvider with polite region, pause-on-hover, actions; mounted in App"`

### Task 9: Instant transaction delete + Undo

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx`
- Test: `src/components/portfolio/TransactionsPanel.test.tsx`

Scope guard for this whole phase: ONLY the four named flows convert. `window.confirm` STAYS at every other site — PaycheckPage profile delete, SecuritiesPanel, CompPage comp-EVENT delete, EsppPage lot/offering/reset, TaxesPage discard + tax-year delete, SettingsPage import clobber, BracketsEditor. Existing inline "Saved."/kept status notes stay everywhere.

- [x] **Step 1: Write the failing test.** In `src/components/portfolio/TransactionsPanel.test.tsx`:
  1. Add `import ToastProvider from '../ToastProvider'` (after the TransactionsPanel import).
  2. In the test `'deleting the row being edited resets the form'`, DELETE the line `vi.spyOn(window, 'confirm').mockReturnValue(true)` — the flow no longer confirms, and a dead spy would claim otherwise.
  3. Append inside the main describe:

```tsx
  it('deletes instantly and Undo re-creates the captured row through the POST', async () => {
    const onChanged = vi.fn()
    render(
      <ToastProvider>
        <TransactionsPanel
          securities={securities}
          transactions={[importTxn]}
          onChanged={onChanged}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // The captured row, re-POSTed field for field — a NEW id is acceptable by design
    // (spec §4 item 8); the split-row '0' dummies would round-trip verbatim the same way.
    await waitFor(() =>
      expect(vi.mocked(createTransaction)).toHaveBeenCalledWith({
        security_id: 1,
        account: 'Schwab',
        type: 'buy',
        txn_date: null,
        shares: '10.000000',
        price: '100.0000',
        fees: null,
        split_factor: null,
        notes: null,
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    // The undo toast is consumed by its own action.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx` → the new test FAILS (no toast; delete may even stall on jsdom's unimplemented confirm); the de-spied edit test PASSES only after Step 3.

- [x] **Step 3: Implement.** In `src/components/portfolio/TransactionsPanel.tsx`:
  1. Add `import { useToast } from '../ToastProvider'` (after the InfoHint import).
  2. In the component body, add `const toast = useToast()` beside the `tickers` const.
  3. Replace `remove` in full:

```tsx
  const remove = (txn: TransactionOut) => {
    const ticker = tickers.get(txn.security_id) ?? '?'
    // Instant + Undo (2026-08-25 polish §8): the confirm interrupt is gone and the
    // recovery affordance replaces it — Undo re-POSTs the captured row (new id, by
    // design). Only this low-risk flow converts; cascade deletes elsewhere keep confirm.
    deleteTransaction(txn.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only: a failed delete leaves the row.
        if (txn.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        // The ledger just changed under the cue — whatever entry session it narrated is over.
        setKept(false)
        onChanged()
        toast.success(`Deleted the ${ticker} ${txn.type}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // TransactionOut carries every TransactionCreate field verbatim, split
              // dummies included (toPayload's convention) — POST accepts them as-is.
              createTransaction({
                security_id: txn.security_id,
                account: txn.account,
                type: txn.type,
                txn_date: txn.txn_date,
                shares: txn.shares,
                price: txn.price,
                fees: txn.fees,
                split_factor: txn.split_factor,
                notes: txn.notes,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${ticker} ${txn.type}`))
            },
          },
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }
```

- [x] **Step 4: Run** — `npx vitest run src/components/portfolio/TransactionsPanel.test.tsx` → ALL PASS (the pre-existing delete/busy tests ride the no-op fallback untouched).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(toast): instant transaction delete with undo re-create"`

### Task 10: Instant dividend delete + Undo

**Files:**
- Modify: `src/components/portfolio/DividendsPanel.tsx`
- Test: `src/components/portfolio/DividendsPanel.test.tsx`

- [x] **Step 1: Write the failing test.** In `src/components/portfolio/DividendsPanel.test.tsx`:
  1. Add `import ToastProvider from '../ToastProvider'` (after the DividendsPanel import).
  2. In `'deleting the row being edited resets the form — on success only'`, DELETE the line `vi.spyOn(window, 'confirm').mockReturnValue(true)` (the failed-then-successful delete choreography underneath is exactly what the instant flow does — it survives unchanged).
  3. Append inside the main describe:

```tsx
  it('deletes instantly and Undo re-creates the payment through the POST', async () => {
    const onChanged = vi.fn()
    render(
      <ToastProvider>
        <DividendsPanel
          securities={securities}
          dividends={[dividend()]}
          annualIncome="432.10"
          onChanged={onChanged}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Deleted the NVDA dividend paid Dec 15, 2025')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // DividendCreate's shape exactly — no id, no provenance fields (an undone auto row
    // comes back as manual, which is honest: the refresh re-writes auto rows anyway).
    await waitFor(() =>
      expect(vi.mocked(createDividend)).toHaveBeenCalledWith({
        security_id: 1,
        account: 'RH Taxable',
        pay_date: '2025-12-15',
        amount: '100.00',
        notes: null,
      }),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/portfolio/DividendsPanel.test.tsx` → the new test FAILS, and so does the de-spied edit-delete test (jsdom's stub confirm returns falsy, so the still-gated delete never runs) — both pass only after Step 3.

- [x] **Step 3: Implement.** In `src/components/portfolio/DividendsPanel.tsx`:
  1. Add `import { useToast } from '../ToastProvider'` (after the StatTile import).
  2. Add `const toast = useToast()` beside the `tickers` const.
  3. Replace `remove` in full:

```tsx
  const remove = (dividend: DividendOut) => {
    const ticker = tickers.get(dividend.security_id) ?? '?'
    // Instant + Undo (2026-08-25 polish §8) — the confirm interrupt is gone; Undo
    // re-POSTs the captured payment (new id, and always source 'manual', by design).
    deleteDividend(dividend.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3, TransactionsPanel's rule). Reset on SUCCESS only: a failed
        // delete leaves the row standing, and the edit session with it.
        if (dividend.id === editingId) {
          setEditingId(null)
          setForm(EMPTY)
        }
        // The ledger just changed under the cue — whatever entry session it narrated is over.
        setKept(false)
        onChanged()
        toast.success(`Deleted the ${ticker} dividend paid ${formatDate(dividend.pay_date)}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createDividend({
                security_id: dividend.security_id,
                account: dividend.account,
                pay_date: dividend.pay_date,
                amount: dividend.amount,
                notes: dividend.notes,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${ticker} dividend`))
            },
          },
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Delete failed')
      })
  }
```

- [x] **Step 4: Run** — `npx vitest run src/components/portfolio/DividendsPanel.test.tsx` → ALL PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(toast): instant dividend delete with undo re-create"`

### Task 11: Calendar custom-event delete toast + Undo

The calendar delete is ALREADY confirm-free — this task adds only the toast + undo. The undo closure is long-lived (the user may page months before pressing it), so the refetch reads the shown month through a ref, never the closure.

**Files:**
- Modify: `src/pages/CalendarPage.tsx`
- Test: `src/pages/CalendarPage.test.tsx`

- [x] **Step 1: Write the failing tests.** In `src/pages/CalendarPage.test.tsx`:
  1. Add `import ToastProvider from '../components/ToastProvider'` (after the CalendarPage import).
  2. Wrap the page in `renderPage`:

```tsx
function renderPage(payload: CalendarEvent[] = fixtureEvents()) {
  vi.mocked(fetchCalendar).mockResolvedValue({ events: payload } satisfies CalendarResponse)
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CalendarPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}
```

  3. In the existing `'Delete removes the row from the popover and refetches'` test, add one assertion after the focus check:

```tsx
    expect(screen.getByText('Deleted Car insurance')).toBeTruthy()
```

  4. Append a new test beside it:

```tsx
  it('Undo re-creates the deleted custom event and refetches', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 77,
      date: DAY_15,
      label: 'Car insurance',
      detail: 'policy 8841',
    })
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: DAY_15,
      label: 'Car insurance',
      detail: 'policy 8841',
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(3))
  })
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/CalendarPage.test.tsx` → the two touched tests FAIL (no toast); the rest PASS.

- [x] **Step 3: Implement.** In `src/pages/CalendarPage.tsx`:
  1. Add `import { useToast } from '../components/ToastProvider'` (after the EventDetails import).
  2. In the component body, add beside `addEventBtnRef`:

```tsx
  const toast = useToast()
  // The undo closure can outlive a month change (the user pages ‹/› and THEN presses
  // Undo): the refetch must follow the month on screen, not the one captured at delete.
  // Unkeyed effect, not a render-time assignment — react-hooks/refs (EChart's idiom).
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
  })
```

  3. Replace `removeEvent` in full:

```tsx
  const removeEvent = (event: CalendarEvent) => {
    if (event.id === null) return
    setDeleting(true)
    deleteCustomEvent(event.id)
      .then(() => {
        setOpen(null)
        // The focused Delete button unmounts with the popover — hand focus to a stable
        // landmark instead of letting it drop to <body> (the Escape path's manners).
        addEventBtnRef.current?.focus()
        setBusy(true)
        load(month)
        // Already confirm-free before this batch; the toast adds the recovery affordance
        // (2026-08-25 polish §8). Undo re-POSTs the row — a new id is acceptable.
        toast.success(`Deleted ${event.label}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCustomEvent({ date: event.date, label: event.label, detail: event.detail })
                .then(() => {
                  setBusy(true)
                  load(monthRef.current)
                })
                .catch(() => toast.error(`Could not restore ${event.label}`))
            },
          },
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not delete the event.')
      })
      .finally(() => setDeleting(false))
  }
```

- [x] **Step 4: Run** — `npx vitest run src/pages/CalendarPage.test.tsx` → ALL PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(toast): calendar custom-event delete toast + undo"`

### Task 12: Instant RSU-grant delete + Undo

**Files:**
- Modify: `src/components/comp/RsuGrantsPanel.tsx`
- Test: `src/pages/CompPage.test.tsx`

- [x] **Step 1: Rewrite the failing pin.** In `src/pages/CompPage.test.tsx`:
  1. Add `import ToastProvider from '../components/ToastProvider'` (after the CompPage import).
  2. KEEP the `confirmSpy` scaffolding — CompPage's comp-EVENT delete still confirms and its tests still need the default-true spy. Replace ONLY the test `'deletes a grant only after the confirm names it'` (body and name) with:

```tsx
  it('deletes a grant instantly, and Undo re-creates it through the POST', async () => {
    render(
      <ToastProvider>
        <CompPage />
      </ToastProvider>,
    )
    await screen.findByText('RSU grants')

    fireEvent.click(screen.getByRole('button', { name: 'Delete the FY26 refresh grant' }))
    // No confirm interrupt any more (2026-08-25 polish §8) — the delete just runs.
    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(vi.mocked(deleteRsuGrant)).toHaveBeenCalledWith(12))
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Deleted the FY26 refresh grant')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // The captured row's STORED fields, verbatim — computed columns never travel back.
    await waitFor(() =>
      expect(vi.mocked(createRsuGrant)).toHaveBeenCalledWith({
        kind: 'refresh',
        label: 'FY26 refresh',
        focal_year: 2026,
        shares: 480,
        grant_price: '129.5651',
        first_vest_date: '2026-09-16',
        cliff_pct: '0.0625',
        vest_quantum: 1,
        notes: 'seeded from focal history',
      }),
    )
    await waitFor(() => expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(3))
  })
```

  (The other grant test that presses Delete — `'keeps the schedule up when a RELOAD of it fails, and says so'` — needs NO change: it asserted nothing about confirm, and the instant delete fires the same refetch it waits on.)

- [x] **Step 2: Run to verify failure** — `npx vitest run src/pages/CompPage.test.tsx` → the rewritten test FAILS (confirm still gates the delete); the rest PASS.

- [x] **Step 3: Implement.** In `src/components/comp/RsuGrantsPanel.tsx`:
  1. Add `import { useToast } from '../ToastProvider'` (after the InfoHint import).
  2. Add `const toast = useToast()` beside the `busy` state.
  3. Replace `remove` in full:

```tsx
  const remove = (grant: RsuGrantOut) => {
    setBusy(true)
    // Cleared on entry like submit's: a delete that succeeds must not leave the previous
    // save's 409 sitting over the panel as if it still described the table.
    setError(null)
    // Instant + Undo (2026-08-25 polish §8): the confirm interrupt is gone. Grants are
    // parameters (the schedule recomputes from them), so a re-POST restores everything.
    deleteRsuGrant(grant.id)
      .then(() => {
        // The edited row is gone — a stale editingId would PATCH a 404 on the next save
        // (Task 14 review I3). Reset on SUCCESS only.
        if (grant.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_GRANT)
        }
        onChanged()
        toast.success(`Deleted the ${grant.label} grant`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // The STORED columns only — vest_count and friends are computed on read.
              createRsuGrant({
                kind: grant.kind,
                label: grant.label,
                focal_year: grant.focal_year,
                shares: grant.shares,
                grant_price: grant.grant_price,
                first_vest_date: grant.first_vest_date,
                cliff_pct: grant.cliff_pct,
                vest_quantum: grant.vest_quantum,
                notes: grant.notes,
              })
                .then(() => onChanged())
                .catch(() => toast.error(`Could not restore the ${grant.label} grant`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }
```

- [x] **Step 4: Run** — `npx vitest run src/pages/CompPage.test.tsx` → ALL PASS.

- [x] **Step 5: Confirm-site audit** — `grep -rn "window.confirm" src --include=*.tsx | grep -v test` → expected hits ONLY in: `src/pages/CompPage.tsx` (comp event), `src/pages/EsppPage.tsx` (×3), `src/pages/PaycheckPage.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/TaxesPage.tsx` (×2), `src/components/portfolio/SecuritiesPanel.tsx`, `src/components/taxes/BracketsEditor.tsx`. TransactionsPanel, DividendsPanel and RsuGrantsPanel must be ABSENT from the list.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(toast): instant RSU-grant delete with undo re-create"`

---

## Phase 4 — Command palette

### Task 13: The fuzzy scorer

**Files:**
- Create: `src/utils/fuzzy.ts`
- Test: `src/utils/fuzzy.test.ts` (create)

- [x] **Step 1: Write the failing tests** — create `src/utils/fuzzy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively and refuses non-subsequences', () => {
    expect(fuzzyScore('SPEN', 'Spending')).toBe(11)
    expect(fuzzyScore('xyz', 'Portfolio')).toBeNull()
    // Order matters — a subsequence is not a bag of letters.
    expect(fuzzyScore('ca', 'Paycheck')).toBeNull()
  })

  it('scores consecutive runs above word starts above scattered hits', () => {
    expect(fuzzyScore('port', 'Portfolio')).toBe(11) // 2 + 3 + 3 + 3
    expect(fuzzyScore('nw', 'Net worth')).toBe(4) // two word heads
    expect(fuzzyScore('pd', 'Spending')).toBe(2) // two scattered hits
    // A consecutive pair outranks the same pair split across a word gap.
    expect(fuzzyScore('ab', 'absolute')!).toBeGreaterThan(fuzzyScore('ab', 'a big')!)
  })

  it('lets the empty query match everything at zero', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0)
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/utils/fuzzy.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/utils/fuzzy.ts`:

```ts
/**
 * Subsequence fuzzy match — the command palette's ranking (2026-08-25 polish §9; no
 * library by design). null = the query is NOT a subsequence of the text. Otherwise an
 * integer score per query character: 3 for extending a consecutive run, 2 for landing on
 * a word head (index 0 or after a space), 1 for a scattered hit — so "port" ranks
 * "Portfolio" first and "nw" still reaches "Net worth" through its word heads.
 * Case-insensitive; the empty query matches everything at 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return 0
  let score = 0
  let searchFrom = 0
  let lastHit = -2 // never adjacent to a first hit at index 0
  for (const ch of q) {
    const hit = t.indexOf(ch, searchFrom)
    if (hit === -1) return null
    if (hit === lastHit + 1) score += 3
    else if (hit === 0 || t[hit - 1] === ' ') score += 2
    else score += 1
    lastHit = hit
    searchFrom = hit + 1
  }
  return score
}
```

- [x] **Step 4: Run** — `npx vitest run src/utils/fuzzy.test.ts` → PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(palette): fuzzy subsequence scorer"`

### Task 14: `CommandPalette` — overlay, actions, recents, mount

**Files:**
- Create: `src/components/CommandPalette.tsx`, `src/components/CommandPalette.css`
- Modify: `src/components/Layout.tsx` (mount)
- Test: `src/components/CommandPalette.test.tsx` (create)

- [x] **Step 1: Write the failing tests** — create `src/components/CommandPalette.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/prices', () => ({
  refreshPrices: vi.fn().mockResolvedValue({}),
}))
import { refreshPrices } from '../api/prices'
import CommandPalette from './CommandPalette'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette />
      <LocationProbe />
      <button>outside button</button>
    </MemoryRouter>,
  )
}

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
const combo = () => screen.getByRole('combobox')

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('CommandPalette', () => {
  it('Ctrl+K opens focused (preventDefault-ing the browser), Escape closes and restores focus', () => {
    renderPalette()
    expect(document.querySelector('.palette-overlay')).toBeNull()
    const outside = screen.getByRole('button', { name: 'outside button' })
    outside.focus()
    // fireEvent returns false when preventDefault ran — the browser's own ^K stays out.
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(false)
    expect(document.activeElement).toBe(combo())
    fireEvent.keyDown(combo(), { key: 'Escape' })
    expect(document.querySelector('.palette-overlay')).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('Cmd+K toggles: a second press closes', () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.querySelector('.palette-overlay')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('wears the combobox pattern: expanded, controls the listbox, tracks the active option', () => {
    renderPalette()
    openPalette()
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    expect(combo().getAttribute('aria-controls')).toBe('palette-listbox')
    const first = screen.getAllByRole('option')[0]
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(combo().getAttribute('aria-activedescendant')).toBe(first.id)
  })

  it('filters by subsequence and Enter navigates', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'spen' } })
    expect(screen.getAllByRole('option')[0].textContent).toContain('Spending')
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(screen.getByTestId('pathname').textContent).toBe('/spending')
    expect(document.querySelector('.palette-overlay')).toBeNull()
  })

  it('arrows move the selection and wrap', () => {
    renderPalette()
    openPalette()
    fireEvent.keyDown(combo(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(combo(), { key: 'ArrowUp' })
    fireEvent.keyDown(combo(), { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true')
  })

  it('traps Tab on the input — the palette is a one-stop focus zone', () => {
    renderPalette()
    openPalette()
    expect(fireEvent.keyDown(combo(), { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(combo())
  })

  it('"Refresh prices" launches the POST and lands on /portfolio', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'refresh' } })
    fireEvent.keyDown(combo(), { key: 'Enter' })
    expect(refreshPrices).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pathname').textContent).toBe('/portfolio')
  })

  it('floats recently-used entries to the top of the unfiltered list, via localStorage', () => {
    renderPalette()
    openPalette()
    fireEvent.change(combo(), { target: { value: 'calen' } })
    fireEvent.keyDown(combo(), { key: 'Enter' }) // → /calendar, recorded
    expect(JSON.parse(localStorage.getItem('commandPalette.recent') ?? '[]')).toEqual([
      'nav:/calendar',
    ])
    openPalette()
    expect(screen.getAllByRole('option')[0].textContent).toContain('Calendar')
  })
})
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/components/CommandPalette.test.tsx` → FAIL (module not found).

- [x] **Step 3: Implement** — create `src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { refreshPrices } from '../api/prices'
import { formatMonth } from '../utils/format'
import { fuzzyScore } from '../utils/fuzzy'
import { currentMonthIso } from '../utils/months'
import './CommandPalette.css'
import { NAV_ITEMS } from './navItems'

interface PaletteItem {
  id: string
  label: string
  kind: 'Go to' | 'Action'
  run: () => void
}

const RECENT_KEY = 'commandPalette.recent'
const RECENT_MAX = 8

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)),
    )
  } catch {
    // Recency ranking is a nicety — a blocked localStorage must not break execution.
  }
}

/**
 * Ctrl/Cmd+K overlay (2026-08-25 polish §9): fuzzy jump over the nav registry plus a
 * small action list, combobox ARIA, recents in localStorage. Hand-rolled — no library.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const openPalette = () => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  const closePalette = () => {
    setOpen(false)
    // The dialog contract: focus goes back where it was taken from.
    previousFocus.current?.focus()
  }

  const items: PaletteItem[] = [
    ...NAV_ITEMS.map((item) => ({
      id: `nav:${item.to}`,
      label: item.label,
      kind: 'Go to' as const,
      run: () => navigate(item.to),
    })),
    {
      id: 'action:refresh-prices',
      label: 'Refresh prices',
      kind: 'Action' as const,
      // LAUNCHED, not awaited: a live refresh takes tens of seconds and the portfolio
      // page's own refresh status reports the run — the palette's job ends at lift-off.
      // The catch is deliberate: an unhandled rejection from a fire-and-forget POST
      // would surface as a console error long after the palette is gone.
      run: () => {
        refreshPrices().catch(() => {})
        navigate('/portfolio')
      },
    },
    {
      id: 'action:enter-update',
      label: `Enter ${formatMonth(currentMonthIso())} update`,
      kind: 'Action' as const,
      run: () => navigate('/update'),
    },
    {
      id: 'action:add-dividend',
      label: 'Add dividend',
      kind: 'Action' as const,
      run: () => navigate('/portfolio'),
    },
    {
      id: 'action:add-custom-event',
      label: 'Add custom event',
      kind: 'Action' as const,
      run: () => navigate('/calendar'),
    },
  ]

  const trimmed = query.trim()
  let filtered: PaletteItem[]
  if (trimmed === '') {
    // Recency floats to the top of the FULL list; the rest keeps registry order
    // (Array.prototype.sort is stable, and non-recent entries all rank RECENT_MAX).
    const rank = new Map(readRecent().map((id, index) => [id, index]))
    filtered = [...items].sort(
      (a, b) => (rank.get(a.id) ?? RECENT_MAX) - (rank.get(b.id) ?? RECENT_MAX),
    )
  } else {
    filtered = items
      .map((item) => ({ item, score: fuzzyScore(trimmed, item.label) }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item)
  }
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1)

  const execute = (item: PaletteItem) => {
    pushRecent(item.id)
    // Close FIRST: the focus restore runs, then the destination's own pathname-change
    // hand-off (Layout's #main focus) takes over.
    closePalette()
    item.run()
  }

  // Unkeyed on purpose (the EChart latest-handler idiom): the listener re-registers each
  // render, so it always sees the current open/close functions without a stale closure.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault() // the browser's own ^K (search bar) must not fire
        if (open) closePalette()
        else openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(() => (filtered.length === 0 ? 0 : (activeIndex + 1) % filtered.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(() =>
        filtered.length === 0 ? 0 : (activeIndex - 1 + filtered.length) % filtered.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) execute(filtered[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
    } else if (event.key === 'Tab') {
      // The trap: the input is the palette's only tab stop; options are pointer/arrow
      // targets (aria-activedescendant carries the selection for AT).
      event.preventDefault()
    }
  }

  if (!open) return null

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `palette-option-${filtered[activeIndex].id}` : undefined
          }
          aria-label="Command palette"
          placeholder="Jump to a page or run an action…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKeyDown}
        />
        {filtered.length === 0 ? (
          <p className="palette-empty">No matches.</p>
        ) : (
          <ul className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands">
            {filtered.map((item, index) => (
              <li
                key={item.id}
                id={`palette-option-${item.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className="palette-option"
                // mousedown, not click: a click's mousedown would blur the input first,
                // and the option must run before any focus bookkeeping reacts to that.
                onMouseDown={(event) => {
                  event.preventDefault()
                  execute(item)
                }}
                onMouseMove={() => {
                  if (index !== activeIndex) setActive(index)
                }}
              >
                <span>{item.label}</span>
                <span className="palette-kind">{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [x] **Step 4: CSS** — create `src/components/CommandPalette.css`:

```css
/* Command palette (2026-08-25 polish §9). Overlay z-index 20: above the app's bubble
   layer (2), below the toast region (30) — an Undo must survive an open palette. */

.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 14vh;
  background: rgba(0, 0, 0, 0.5);
}

.palette {
  width: min(560px, calc(100vw - 2rem));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.palette-input {
  width: 100%;
  padding: 0.8rem 1rem;
  border: none;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.95rem;
}

/* The overlay IS the focus ring — a second ring inside it would double-outline. */
.palette-input:focus {
  outline: none;
}

.palette-list {
  list-style: none;
  margin: 0;
  padding: 0.35rem;
  max-height: 320px;
  overflow-y: auto;
}

.palette-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  color: var(--text);
  font-size: 0.85rem;
  cursor: pointer;
}

/* The sidebar's active grammar, reused: inset accent bar + surface. */
.palette-option[aria-selected='true'] {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--accent);
}

.palette-kind {
  color: var(--muted);
  font-size: 0.7rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.palette-empty {
  margin: 0;
  padding: 0.75rem 1rem;
  color: var(--muted);
  font-size: 0.85rem;
}
```

- [x] **Step 5: Mount in Layout.** In `src/components/Layout.tsx`, add `import CommandPalette from './CommandPalette'` (after the AuthContext import, before `'./Layout.css'`) and render `<CommandPalette />` as the LAST child of the `.layout` div (after `</main>`). Layout-mounted, not App-mounted: the palette needs `useNavigate`, and it must exist only behind login.

- [x] **Step 6: Run** — `npx vitest run src/components/CommandPalette.test.tsx src/components/Layout.test.tsx` → ALL PASS (the palette renders null while closed, so Layout's pins are untouched).

- [x] **Step 7: Commit** — `git add -A && git commit -m "feat(palette): Ctrl+K command palette with fuzzy nav, actions, recents"`

---

## Phase 5 — Verification

### Task 15: Full verification (STOP here — the orchestrator merges)

**Files:** none (verification only; commit only if a step below changes files)

- [ ] **Step 1: Full frontend suite** — `npx vitest run` → ALL PASS (record the count; the batch adds 8 new test files and ~35 new tests over the 791 baseline).
- [ ] **Step 2: Types** — `npx tsc -b` → exits clean, no output.
- [ ] **Step 3: Lint** — `npx eslint .` → exits 0. (react-refresh/only-export-components is configured as WARN and already fires on context modules; ToastProvider may add one warning — warnings do not fail the command and no new ERROR may appear.)
- [ ] **Step 4: Spec-coverage sweep** — re-read spec §4's nine numbered items against the commits; each maps to Tasks 1–14. Then two greps: `grep -rn "c98500" src` → 3 hits (Task 1's expected set); `grep -rln "PlaceholderPage" src` → the file alone.
- [ ] **Step 5: Clean tree** — `git status --porcelain` → EMPTY. If any step above touched files (a lint fix), commit them: `git add -A && git commit -m "chore(polish): verification pass fixes"`.
- [ ] **Step 6: STOP.** Do not merge, do not push, do not delete anything — the orchestrator reviews and merges this branch. Leave a summary listing: the test count, the ten labelled charts, the four converted delete flows (and that every other `window.confirm` site survives — Task 12 Step 5's list), the `useToast` no-op-outside-provider posture, and the EChart cross-plan note (only `ariaLabel` was added, additively, for the parallel `exportConfig` branch).
