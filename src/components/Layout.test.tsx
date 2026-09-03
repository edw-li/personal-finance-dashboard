import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCreditCards } from '../api/creditCards'
import { fetchAccounts } from '../api/netWorth'
import { fetchSecurities } from '../api/portfolio'
import { fetchCategories } from '../api/spending'
import { fetchSystemStatus } from '../api/system'
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

// The shell mounts the REAL AssistantDrawer (its presence in the layout is the contract
// under test), so only its network module is stubbed — no shell test may reach fetch.
// Wrappers rather than the vi.fn()s themselves: this factory is hoisted above the consts,
// and only a call-time dereference survives that (AssistantDrawer.test.tsx's idiom).
const fetchAssistantSettings = vi.fn()
const fetchAssistantModels = vi.fn()
const fetchContextPreview = vi.fn()
vi.mock('../api/assistant', () => ({
  fetchAssistantSettings: (...a: unknown[]) => fetchAssistantSettings(...a),
  fetchAssistantModels: (...a: unknown[]) => fetchAssistantModels(...a),
  fetchContextPreview: (...a: unknown[]) => fetchContextPreview(...a),
}))

// Same rule for the palette's entity lists: opening it (three tests below do) loads
// tickers, accounts, categories and cards, and no shell test may reach fetch. The empty
// resolutions are seeded per test, not in the factories: this file's afterEach restores
// every mock, which would strip a factory-set implementation after the first test.
vi.mock('../api/portfolio', () => ({ fetchSecurities: vi.fn() }))
vi.mock('../api/netWorth', () => ({ fetchAccounts: vi.fn() }))
vi.mock('../api/spending', () => ({ fetchCategories: vi.fn() }))
vi.mock('../api/creditCards', () => ({ fetchCreditCards: vi.fn() }))

// The sidebar footer asks /system/status for its environment pill — same rule, no shell
// test may reach fetch.
vi.mock('../api/system', () => ({ fetchSystemStatus: vi.fn() }))

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
  // Configured, with a one-entry catalog: the drawer then settles on a STRUCTURAL landmark
  // (its composer) that the shell tests can wait for without knowing a word of its copy.
  fetchAssistantSettings.mockReset().mockResolvedValue({
    key: { configured: true, source: 'env' },
    default_model: 'kimi-k3',
  })
  fetchAssistantModels.mockReset().mockResolvedValue({
    configured: true,
    key_source: 'env',
    key_ok: true,
    checked_at: '2026-09-01T00:00:00Z',
    models: [
      { key: 'kimi-k3', label: 'Kimi K3', available: true, supports_tools: true, default: true },
    ],
  })
  fetchContextPreview.mockReset().mockResolvedValue({ sections: [] })
  vi.mocked(fetchSecurities).mockResolvedValue([])
  vi.mocked(fetchAccounts).mockResolvedValue([])
  vi.mocked(fetchCategories).mockResolvedValue([])
  vi.mocked(fetchCreditCards).mockResolvedValue([])
  vi.mocked(fetchSystemStatus).mockResolvedValue({
    environment: 'dev',
    database: { alembic_head: 'f7d3b2a91c40', size_bytes: 1 },
  } as never)
})

afterEach(async () => {
  // The palette's entity fetches (mocked above) settle after the assertions do; flushing
  // them here keeps their setState inside act().
  await act(async () => {})
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
      'Portfolio',
      'Spending',
      'Credit cards',
      'Paycheck',
      'Comp',
      'ESPP',
      'Taxes',
      'Projection',
      'Calendar',
      'Settings',
    ])
    // The footer closes the sidebar — it carries the old separator's border, the identity
    // block and Log out.
    expect(document.querySelector('.sidebar-footer')).not.toBeNull()
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

describe('Layout — assistant mount', () => {
  it('mounts the assistant launcher, closed, without disturbing arrival focus', () => {
    renderShell()
    expect(screen.getByRole('button', { name: 'Open assistant' })).toBeTruthy()
    // Mounted ≠ open: the drawer costs the page nothing until someone asks for it, and
    // the arrival contract (browser's own focus stands) must survive the extra component.
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(fetchAssistantSettings).not.toHaveBeenCalled()
  })

  // The palette's discoverability, and the bus that carries the ask: the row is in the
  // sidebar, the palette is mounted next to <main>, and neither imports the other.
  it('offers a visible search row that opens the palette', () => {
    renderShell()
    expect(screen.queryByRole('combobox', { name: 'Command palette' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Search or jump/ }))
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeTruthy()
  })

  // The whole F7 wiring end to end: the palette asks the bus, the drawer Layout mounted
  // answers. Neither knows about the other — this is the only place that proves the two
  // halves meet.
  it('opens the drawer from the palette Ask assistant action', async () => {
    renderShell()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const combo = screen.getByRole('combobox')
    fireEvent.change(combo, { target: { value: 'assistant' } })
    fireEvent.keyDown(combo, { key: 'Enter' })
    expect(await screen.findByRole('complementary', { name: 'Assistant' })).toBeTruthy()
    // Settles the settings fetch inside act, structurally: the composer is the drawer's
    // contract, its wording is not, so no copy edit in there can break a shell test.
    expect(await screen.findByRole('textbox', { name: /ask the assistant/i })).toBeTruthy()
  })

  // The palette sits ABOVE the drawer (z 20 vs 15) and both answer Escape. One keypress
  // must dismiss exactly one of them: the drawer's window-level listener stands down for
  // whoever already called preventDefault.
  it('Escape in the palette closes only the palette, leaving the drawer open', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    await screen.findByRole('textbox', { name: /ask the assistant/i })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Command palette' }), {
      key: 'Escape',
    })
    expect(document.querySelector('.palette-overlay')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy()
  })
})
