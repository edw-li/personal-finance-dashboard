import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false, authError: null, retry: vi.fn() }))
vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => auth,
}))
vi.mock('./components/shell/ThemeProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('./components/ToastProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('./prefs/SessionPrefs', () => ({ default: () => null }))
vi.mock('./prefs/LandingRedirect', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('./pages/LoginPage', async () => {
  const { Link } = await import('react-router-dom')
  return { default: () => <><h1>Sign in</h1><Link to="/">Return to app</Link></> }
})
vi.mock('./components/routeChunks', async () => {
  const { useLocation } = await import('react-router-dom')
  function Page() { return <h1>Page {useLocation().pathname}</h1> }
  const routes = ['/', '/update', '/net-worth', '/spending', '/portfolio', '/credit-cards', '/taxes', '/espp', '/paycheck', '/comp', '/calendar', '/projection', '/settings']
  return { ROUTE_CHUNKS: Object.fromEntries(routes.map(route => [route, async () => ({ default: Page })])) }
})
vi.mock('./components/Layout', async () => {
  const { Suspense } = await import('react')
  const { Link, Outlet } = await import('react-router-dom')
  const { useDetailPanel } = await import('./components/details/DetailPanelProvider')
  const { default: MetricInspector } = await import('./components/details/MetricInspector')
  const metric = { id: 'private-balance', label: 'Captured balance', definition_version: 'test-v1', definition: 'Private financial amount',
    value: '8675309.42', unit: 'USD', scope: 'household', completeness: 'complete', components: [],
    source_link: '/net-worth', source_label: 'Open source', as_of: '2026-09-01', warnings: [] }
  function Layout() {
    const panel = useDetailPanel()!
    return <>
      <Link to="/portfolio">Go to portfolio</Link>
      <button onClick={() => panel.open({ id: 'assistant', title: 'Financial question', content:
        <button onClick={() => panel.open({ id: 'assistant-metric:private-balance', title: 'Captured balance', content: <MetricInspector evidence={metric} /> })}>Inspect captured balance</button>,
      })}>Open financial question</button>
      <Suspense fallback={<p>Loading page</p>}><Outlet /></Suspense>
    </>
  }
  return { default: Layout }
})

import App from './App'

beforeEach(() => {
  auth.isAuthenticated = true
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  window.history.replaceState(null, '', '/')
})
afterEach(cleanup)

async function openCapturedEvidence() {
  await screen.findByRole('heading', { name: 'Page /' })
  fireEvent.click(screen.getByRole('button', { name: 'Open financial question' }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect captured balance' }))
  expect(screen.getByText('$8,675,309.42')).toBeTruthy()
}

describe('authenticated detail-panel lifetime', () => {
  it('removes nested financial evidence on logout and starts the next session with no panel history', async () => {
    const { rerender } = render(<App />)
    await openCapturedEvidence()
    auth.isAuthenticated = false
    rerender(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('$8,675,309.42')).toBeNull()
    auth.isAuthenticated = true
    rerender(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Return to app' }))
    await screen.findByRole('heading', { name: 'Page /' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open financial question' }))
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('preserves nested history during normal authenticated page navigation', async () => {
    render(<App />)
    await openCapturedEvidence()
    fireEvent.click(screen.getByRole('link', { name: 'Go to portfolio' }))
    await screen.findByRole('heading', { name: 'Page /portfolio' })
    expect(screen.getByRole('dialog', { name: 'Captured balance' })).toBeTruthy()
    expect(screen.getByText('$8,675,309.42')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog', { name: 'Financial question' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect captured balance' })).toBeTruthy()
  })
})
