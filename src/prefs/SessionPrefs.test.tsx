import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setToken } from '../api/client'
import { DIRTY_STORAGE_KEY, isSynced, resetPrefsStoreForTests, setLocal } from './prefsStore'
import SessionPrefs from './SessionPrefs'

vi.mock('../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))
import { fetchPrefs, patchPrefs } from '../api/prefs'

// The component reads one field off the context; session plumbing is AuthContext.test's job.
// The switch is read at CALL time, not in the hoisted factory, so a rerender can flip it.
let authed = false
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: authed }) }))

beforeEach(() => {
  localStorage.clear()
  resetPrefsStoreForTests()
  authed = false
  setToken('tok')
  vi.mocked(fetchPrefs).mockResolvedValue({ prefs: {} })
  vi.mocked(patchPrefs).mockResolvedValue({ prefs: {} })
})

afterEach(() => {
  cleanup()
  resetPrefsStoreForTests() // no debounce timer may outlive its test
  vi.clearAllMocks()
})

it('syncs when the session becomes authenticated, and ends it at sign-out', async () => {
  authed = true
  const view = render(<SessionPrefs />)
  await waitFor(() => expect(isSynced()).toBe(true))
  expect(fetchPrefs).toHaveBeenCalledTimes(1)
  setLocal('theme', 'light') // dirty, with its PATCH still inside the debounce
  authed = false
  view.rerender(<SessionPrefs />)
  // Logging out and back in never reloads the document, so without this the next account's
  // sync would find THIS one's dirty keys and seed its server from them, and Appearance would
  // say "Synced to your account." before the GET.
  expect(isSynced()).toBe(false)
  expect(localStorage.getItem(DIRTY_STORAGE_KEY)).toBeNull()
})

it('does not end a session that never started — a fresh load keeps its unsent changes', () => {
  setLocal('theme', 'light') // what the store re-read from storage after a reload
  render(<SessionPrefs />) // isAuthenticated is false until /auth/me answers
  expect(localStorage.getItem(DIRTY_STORAGE_KEY)).toBe(JSON.stringify(['theme']))
  expect(fetchPrefs).not.toHaveBeenCalled()
})
