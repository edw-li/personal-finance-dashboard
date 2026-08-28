import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from './Layout'
import { prefetchRoute, warmAllRoutes } from './routeChunks'

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

vi.mock('./routeChunks', () => ({
  prefetchRoute: vi.fn(),
  warmAllRoutes: vi.fn(),
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

// POP can't be clicked in a MemoryRouter — a probe button issues navigate(-1).
function BackProbe() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>go back</button>
}

function renderBackShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>home body</div>} />
          <Route
            path="/spending"
            element={
              <div>
                spending body
                <BackProbe />
              </div>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// Search-param drill: pathname stays put; only the query (and location.key) change.
function DrillProbe() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/spending?cat=dining')}>drill</button>
}

function renderDrillShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>home body</div>} />
          <Route
            path="/spending"
            element={
              <div>
                spending body
                <DrillProbe />
              </div>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // jsdom's scrollTo is a not-implemented stub that logs to the console; the reset
  // assertion wants a spy anyway.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  sessionStorage.clear()
  // vi.mock factories are hoisted and vi.restoreAllMocks only restores vi.spyOn spies, so
  // these vi.fn()s would otherwise accumulate call history across this file's tests.
  vi.mocked(warmAllRoutes).mockClear()
  vi.mocked(prefetchRoute).mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
      'Credit cards',
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

describe('Layout — scroll restoration', () => {
  it('takes manual control of history scroll restoration', () => {
    renderShell()
    expect(history.scrollRestoration).toBe('manual')
  })

  it('restores the recorded depth on POP and still resets on PUSH', () => {
    // Deterministic rAF: the recorder's throttle collapses to a synchronous call.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    renderBackShell()

    // Scroll the home page to 480 — the recorder stores it for this history entry.
    Object.defineProperty(window, 'scrollY', { value: 480, configurable: true })
    fireEvent.scroll(window)

    // PUSH to /spending: today's behavior — focus main, top of page.
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    expect(screen.getByText('spending body')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
    expect(document.activeElement).toBe(screen.getByRole('main'))

    // POP back home: the recorded 480 comes back, focus still lands on main.
    fireEvent.click(screen.getByRole('button', { name: 'go back' }))
    expect(screen.getByText('home body')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 480)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('never yanks focus or scroll on a search-param navigation (page-drill contract)', () => {
    renderDrillShell()
    // PUSH to /spending: the reset fires once, as on any pathname change.
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    // Drill: location.key changes, pathname does not — focus and depth must survive.
    const drill = screen.getByRole('button', { name: 'drill' })
    drill.focus()
    fireEvent.click(drill)
    expect(screen.getByText('spending body')).toBeTruthy()
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(drill)
  })

  it('defaults a POP with no recording to the top', () => {
    renderBackShell()
    fireEvent.click(screen.getByRole('link', { name: 'Spending' }))
    fireEvent.click(screen.getByRole('button', { name: 'go back' }))
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
  })
})
