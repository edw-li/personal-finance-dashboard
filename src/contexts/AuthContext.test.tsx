import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import * as authApi from '../api/auth'
import { clearSnapshots, getSnapshot, setSnapshot } from '../api/snapshotCache'

vi.mock('../api/auth', () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

function Probe() {
  const { isAuthenticated, isLoading, logout } = useAuth()
  return (
    <>
      <div data-testid="probe">{`${isAuthenticated}|${isLoading}`}</div>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  clearSnapshots()
})

afterEach(() => {
  // RTL auto-cleanup needs a global afterEach; vitest runs without globals here,
  // so clean up explicitly or renders accumulate across tests in this file.
  cleanup()
  vi.clearAllMocks()
})

it('never calls fetchMe on a tokenless mount (load-bearing loop guard)', () => {
  // Without the guard, a tokenless mount calls /auth/me, gets 401, and client.ts
  // clears+redirects to /login, remounting this provider in an infinite reload loop.
  // Mutation-proven in Plan 1: deleting the guard passed lint+build+CI green.
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  expect(vi.mocked(authApi.fetchMe)).not.toHaveBeenCalled()
  expect(screen.getByTestId('probe').textContent).toBe('false|false')
})

it('fetches the session exactly once when a token exists', async () => {
  localStorage.setItem('finance_token', 'a-token')
  vi.mocked(authApi.fetchMe).mockResolvedValue({ email: 'me@example.com' })
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  await waitFor(() => {
    expect(screen.getByTestId('probe').textContent).toBe('true|false')
  })
  expect(vi.mocked(authApi.fetchMe)).toHaveBeenCalledTimes(1)
})

it('logout wipes the page-snapshot cache', () => {
  // Snapshots are session data: the next user through this tab must never see them.
  setSnapshot('overview', { stale: true })
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
  expect(vi.mocked(authApi.logout)).toHaveBeenCalledTimes(1)
  expect(getSnapshot('overview')).toBeUndefined()
})
