import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import * as authApi from '../api/auth'

vi.mock('../api/auth', () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

function Probe() {
  const { isAuthenticated, isLoading } = useAuth()
  return <div data-testid="probe">{`${isAuthenticated}|${isLoading}`}</div>
}

beforeEach(() => {
  localStorage.clear()
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
