import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setToken } from '../api/client'
import {
  DIRTY_STORAGE_KEY,
  PATCH_DEBOUNCE_MS,
  PREFS_SNAPSHOT,
  STORAGE_KEYS,
  endSession,
  getLocal,
  isSynced,
  resetPrefsStoreForTests,
  setLocal,
  subscribe,
  subscribeSynced,
  syncFromServer,
} from './prefsStore'

vi.mock('../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))
import { fetchPrefs, patchPrefs } from '../api/prefs'
import { getSnapshot } from '../api/snapshotCache'

const entry = (value: unknown) => ({ value, updated_at: '2026-09-04T09:00:00+00:00' })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetPrefsStoreForTests()
  setToken('tok') // a PATCH needs a session; without one the store stays local
  vi.mocked(fetchPrefs).mockResolvedValue({ prefs: {} })
  vi.mocked(patchPrefs).mockResolvedValue({ prefs: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('prefsStore — local mirror', () => {
  it('reads and writes the shell\'s own localStorage spellings, key by key', () => {
    localStorage.setItem('finance.theme', 'light')
    localStorage.setItem('finance.scope', JSON.stringify({ owner: 2, range: 'ytd' }))
    localStorage.setItem('commandPalette.recent', JSON.stringify(['nav:/', 'action:refresh-prices']))
    expect(getLocal('theme')).toBe('light')
    expect(getLocal('density')).toBeUndefined()
    expect(getLocal('scope')).toEqual({ owner: 2, range: 'ytd' })
    expect(getLocal('palette_recents')).toEqual(['nav:/', 'action:refresh-prices'])
    expect(getLocal('landing_page')).toBeUndefined()
    setLocal('density', 'compact')
    setLocal('landing_page', '/net-worth')
    expect(localStorage.getItem(STORAGE_KEYS.density)).toBe('compact')
    expect(localStorage.getItem(STORAGE_KEYS.landing_page)).toBe('/net-worth')
    expect(STORAGE_KEYS).toEqual({
      theme: 'finance.theme',
      density: 'finance.density',
      scope: 'finance.scope',
      palette_recents: 'commandPalette.recent',
      landing_page: 'finance.landingPage',
    })
  })

  it('ignores garbage in storage', () => {
    localStorage.setItem('finance.theme', 'neon')
    localStorage.setItem('finance.scope', '{not json')
    expect(getLocal('theme')).toBeUndefined()
    expect(getLocal('scope')).toBeUndefined()
  })
})

describe('prefsStore — the debounced PATCH', () => {
  it('coalesces changes to one key into one PATCH 400 ms after the last, in the server spelling', async () => {
    setLocal('theme', 'light')
    setLocal('theme', 'system')
    setLocal('scope', { owner: null, range: 'ytd' })
    expect(patchPrefs).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS - 1)
    expect(patchPrefs).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(patchPrefs).toHaveBeenCalledTimes(2)
    expect(vi.mocked(patchPrefs).mock.calls.map((c) => c[0])).toEqual([
      { theme: 'system' },
      { scope: { owner: 'all', range: 'ytd' } }, // null owner is the server's "all"
    ])
  })

  it('swallows a failed PATCH and retries it with the next change', async () => {
    vi.mocked(patchPrefs).mockRejectedValueOnce(new Error('500'))
    setLocal('theme', 'light')
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).toHaveBeenCalledTimes(1)
    setLocal('density', 'compact')
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    // The retried theme rides along with the new density.
    expect(vi.mocked(patchPrefs).mock.calls[1][0]).toEqual({ density: 'compact', theme: 'light' })
  })

  it('never PATCHes without a session token — the browser keeps the value locally', async () => {
    localStorage.removeItem('finance_token')
    setLocal('theme', 'light')
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).not.toHaveBeenCalled()
    expect(localStorage.getItem('finance.theme')).toBe('light')
  })
})

describe('prefsStore — session sync', () => {
  it('seeds the server from the browser when the server has nothing, and caches the GET', async () => {
    localStorage.setItem('finance.theme', 'light')
    localStorage.setItem('finance.scope', JSON.stringify({ owner: 'joint', range: 'all' }))
    const seen: boolean[] = []
    subscribeSynced((v) => seen.push(v))
    await syncFromServer()
    expect(fetchPrefs).toHaveBeenCalledTimes(1)
    expect(getSnapshot(PREFS_SNAPSHOT)).toEqual({ prefs: {} })
    expect(patchPrefs).toHaveBeenCalledWith({ theme: 'light', scope: { owner: 'joint', range: 'all' } })
    expect(patchPrefs).toHaveBeenCalledTimes(1) // ONE seed for the whole browser copy
    expect(isSynced()).toBe(true)
    expect(seen).toEqual([true])
  })

  it('adopts the server value into storage and notifies subscribers when the server has one', async () => {
    localStorage.setItem('finance.theme', 'light')
    const heard: string[] = []
    subscribe('theme', (v) => heard.push(v))
    vi.mocked(fetchPrefs).mockResolvedValue({
      prefs: { theme: entry('system'), scope: entry({ owner: 3, range: '1y' }), landing_page: entry('/taxes') },
    })
    await syncFromServer()
    expect(localStorage.getItem('finance.theme')).toBe('system')
    expect(heard).toEqual(['system'])
    expect(getLocal('scope')).toEqual({ owner: 3, range: '1y' })
    expect(getLocal('landing_page')).toBe('/taxes')
    expect(patchPrefs).not.toHaveBeenCalled()
  })

  it('keeps a key the user changed this session and PATCHes it up instead of adopting', async () => {
    let release: (value: { prefs: Record<string, { value: unknown; updated_at: string }> }) => void = () => {}
    vi.mocked(fetchPrefs).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const sync = syncFromServer()
    setLocal('theme', 'light') // the user toggles before the answer lands
    release({ prefs: { theme: entry('system'), density: entry('compact') } })
    await sync
    expect(localStorage.getItem('finance.theme')).toBe('light')
    expect(localStorage.getItem('finance.density')).toBe('compact') // untouched keys still adopt
    expect(patchPrefs).toHaveBeenCalledWith({ theme: 'light' })
  })

  // The browser spells the household `owner: null` (OwnerScope); the WIRE spells it the
  // string 'all' (backend prefs_registry) — a seed that shipped null would 422, and an
  // adopted 'all' that stayed a string would fail useScope's own predicates.
  it('round-trips the scope owner: null in the browser, "all" on the wire', async () => {
    setLocal('scope', { owner: null, range: 'all' })
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).toHaveBeenCalledWith({ scope: { owner: 'all', range: 'all' } })
    resetPrefsStoreForTests() // a fresh session: nothing is dirty, so the server's copy wins
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: { scope: entry({ owner: 'all', range: 'ytd' }) } })
    await syncFromServer()
    expect(getLocal('scope')).toEqual({ owner: null, range: 'ytd' })
    expect(localStorage.getItem('finance.scope')).toBe(JSON.stringify({ owner: null, range: 'ytd' }))
  })

  // Same rule, harder timing: the toggle's own PATCH lands BEFORE the answer to a GET that
  // was issued before the toggle. That answer still carries the pre-toggle value, so the key
  // being "confirmed" by the PATCH must not make the sync adopt it.
  it('keeps that key even when its PATCH lands before the GET answers', async () => {
    let release: (value: { prefs: Record<string, { value: unknown; updated_at: string }> }) => void = () => {}
    vi.mocked(fetchPrefs).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const sync = syncFromServer()
    setLocal('theme', 'light')
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).toHaveBeenCalledWith({ theme: 'light' })
    release({ prefs: { theme: entry('system') } })
    await sync
    expect(localStorage.getItem('finance.theme')).toBe('light')
  })

  it('ignores a server value of the wrong shape and stays quiet when the GET fails', async () => {
    localStorage.setItem('finance.theme', 'light')
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: { theme: entry('neon') } })
    await syncFromServer()
    expect(localStorage.getItem('finance.theme')).toBe('light')
    resetPrefsStoreForTests()
    vi.mocked(fetchPrefs).mockRejectedValue(new Error('offline'))
    await expect(syncFromServer()).resolves.toBeUndefined()
    expect(isSynced()).toBe(false)
  })
})

// Spec §10 rule 4 promises a failed PATCH retries "on the next change or session" — and a
// reload happens between those. In memory only, the dirty set died with the tab and the next
// session ADOPTED the server's stale value, silently reverting what the user had picked.
describe('prefsStore — the dirty set survives a reload', () => {
  it('re-PATCHes a key whose PATCH failed before the reload instead of adopting over it', async () => {
    vi.mocked(patchPrefs).mockRejectedValueOnce(new Error('500'))
    setLocal('theme', 'light')
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(DIRTY_STORAGE_KEY) ?? '[]')).toEqual(['theme'])
    resetPrefsStoreForTests() // the reload: memory is gone, localStorage is not
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: { theme: entry('system') } })
    await syncFromServer()
    expect(patchPrefs).toHaveBeenLastCalledWith({ theme: 'light' })
    expect(localStorage.getItem('finance.theme')).toBe('light')
    // The retry landed, so the key is the server's business again — the NEXT session adopts.
    expect(localStorage.getItem(DIRTY_STORAGE_KEY)).toBeNull()
  })

  it('forgets a key as soon as its PATCH succeeds, so a second browser can still be adopted', async () => {
    setLocal('density', 'compact')
    expect(JSON.parse(localStorage.getItem(DIRTY_STORAGE_KEY) ?? '[]')).toEqual(['density'])
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(localStorage.getItem(DIRTY_STORAGE_KEY)).toBeNull()
    resetPrefsStoreForTests()
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: { density: entry('comfortable') } })
    await syncFromServer()
    expect(getLocal('density')).toBe('comfortable')
  })
})

describe('prefsStore — session end', () => {
  it('drops the sync state at sign-out so the next account is adopted, not seeded', async () => {
    const seen: boolean[] = []
    subscribeSynced((v) => seen.push(v))
    await syncFromServer()
    expect(isSynced()).toBe(true)
    setLocal('theme', 'light') // dirty, with its PATCH still inside the debounce
    vi.mocked(patchPrefs).mockClear()
    endSession()
    expect(isSynced()).toBe(false)
    expect(seen).toEqual([true, false]) // Appearance must stop claiming "Synced to your account."
    expect(localStorage.getItem(DIRTY_STORAGE_KEY)).toBeNull()
    await vi.advanceTimersByTimeAsync(PATCH_DEBOUNCE_MS)
    expect(patchPrefs).not.toHaveBeenCalled() // the pending PATCH went with the session
    // The next sign-in in this tab: nothing is dirty, so the account's own value wins.
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: { theme: entry('system') } })
    await syncFromServer()
    expect(localStorage.getItem('finance.theme')).toBe('system')
    expect(patchPrefs).not.toHaveBeenCalled()
  })
})
