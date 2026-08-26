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
