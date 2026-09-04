import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProtectedRoute from './ProtectedRoute'

// One mutable object the tests rewrite between renders; the factory is hoisted above it,
// so only a call-time dereference survives (Layout.test.tsx's idiom).
const auth = {
  isAuthenticated: false,
  isLoading: true,
  authError: null as string | null,
  retry: vi.fn(),
}
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

// A FACTORY, not a stored element: React bails out of re-rendering a subtree whose element
// is referentially identical to the last one, so a shared constant would make rerender() a
// no-op and every "and then the auth state changed" assertion vacuously true.
const tree = () => (
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>the app</div>} />
      </Route>
      <Route path="/login" element={<div>the login</div>} />
    </Routes>
  </MemoryRouter>
)

function renderRoute() {
  return render(tree())
}

beforeEach(() => {
  vi.useFakeTimers()
  auth.isAuthenticated = false
  auth.isLoading = true
  auth.authError = null
  auth.retry = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The blank page this replaces was indistinguishable from a broken app: a token-bearing
// visitor saw nothing at all until /auth/me answered (up to the 15 s timeout).
it('shows the wordmark at once and the spinner only once the wait is worth naming', () => {
  renderRoute()
  expect(screen.getByText('Personal finance')).toBeTruthy()
  expect(screen.queryByLabelText('Connecting…')).toBeNull()
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(screen.getByLabelText('Connecting…')).toBeTruthy()
  expect(screen.queryByText('the app')).toBeNull()
})

it('prints the sentence AuthContext handed it and offers a Retry rather than a redirect', () => {
  auth.isLoading = false
  // Verbatim, not decorated: AuthContext already decided whether this was an unreachable
  // server or a server that answered badly, and a 500 wearing a "can't reach the server"
  // prefix would send the user off to debug their own network.
  auth.authError = 'Database is on fire'
  renderRoute()
  const splash = screen.getByRole('status').textContent ?? ''
  expect(splash).toContain('Database is on fire')
  expect(splash).not.toMatch(/reach the server/)
  // Not the login: the token may be perfectly good, and signing out would be the app
  // blaming the user for its own dropped connection.
  expect(screen.queryByText('the login')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(auth.retry).toHaveBeenCalledTimes(1)
})

// The spinner is a promise that something is still happening; re-showing one that was
// already turning when the LAST attempt failed makes the wait look zero-length.
it('makes a retried wait earn the spinner again instead of flashing the old one', () => {
  const { rerender } = renderRoute()
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(screen.getByRole('img', { name: 'Connecting…' })).toBeTruthy()

  // The attempt fails: the splash swaps the spinner for a sentence and a Retry.
  auth.isLoading = false
  auth.authError = "Can't reach the server — Request timed out"
  rerender(tree())
  expect(screen.queryByLabelText('Connecting…')).toBeNull()

  // Retry: loading again, and the 300 ms of silence starts over.
  auth.isLoading = true
  auth.authError = null
  rerender(tree())
  expect(screen.queryByLabelText('Connecting…')).toBeNull()
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(screen.getByLabelText('Connecting…')).toBeTruthy()
})

it('sends a settled, signed-out visitor to the login', () => {
  auth.isLoading = false
  renderRoute()
  expect(screen.getByText('the login')).toBeTruthy()
})

it('renders the route once the session is known', () => {
  auth.isLoading = false
  auth.isAuthenticated = true
  renderRoute()
  expect(screen.getByText('the app')).toBeTruthy()
})
