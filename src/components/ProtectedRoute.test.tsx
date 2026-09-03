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

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>the app</div>} />
        </Route>
        <Route path="/login" element={<div>the login</div>} />
      </Routes>
    </MemoryRouter>
  )
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
  expect(screen.getByText('Finance')).toBeTruthy()
  expect(screen.queryByLabelText('Connecting…')).toBeNull()
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(screen.getByLabelText('Connecting…')).toBeTruthy()
  expect(screen.queryByText('the app')).toBeNull()
})

it('names an unreachable server and offers a Retry rather than a redirect', () => {
  auth.isLoading = false
  auth.authError = 'Network error — is the server reachable?'
  renderRoute()
  expect(screen.getByRole('status').textContent).toMatch(/reach the server/)
  // Not the login: the token may be perfectly good, and signing out would be the app
  // blaming the user for its own dropped connection.
  expect(screen.queryByText('the login')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(auth.retry).toHaveBeenCalledTimes(1)
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
