# Data lifecycle F2 — Activity card + wizard Undo, preferences store + adoption, Data health card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §9–§11 in the browser: `prefsStore` (local-first paint, seed-up on an empty server, server-wins otherwise, per-key dirty exception, 400 ms debounced PATCH, silent failure) adopted by `ThemeProvider`, `useScope` and the palette's recents; the session sync after `/auth/me` and the first-arrival `landing_page` redirect; the Appearance card's Landing page control and "Synced to your account" line; the two month DELETE fetchers reading `X-Change-Batch`; the wizard's save and delete toasts gaining Undo (spending batch, then balances batch); the **Activity** card (`id="activity"`) with arm-on-click Undo, View report and Load more; the **Data health** card (`id="health"`) with link fixes and the armed repair (toast with Undo, refetch).

**Architecture:** `src/prefs/prefsStore.ts` is a module singleton over `localStorage` (the SAME key spellings the shell writes today, so nothing is lost on deploy) plus Phase 0's `api/prefs.ts`; consumers call `getLocal`/`setLocal`/`subscribe`. `SessionPrefs` (mounted in `App.tsx` inside `AuthProvider`) runs `syncFromServer()` when the session becomes authenticated; `LandingRedirect` wraps the `/` route and redirects once per tab. The two cards follow the settings-card recipe and render reports through `ImportReportView` (existing) and Phase 0's `RestoreReportView`.

**Tech Stack:** React 19, react-router 7, TypeScript, vitest (fake timers for the debounce) + Testing Library.

**Worktree / commands:** Branch `lifecycle-f2` from main AFTER `lifecycle-base` merged (check: `src/api/prefs.ts`, `src/api/lifecycle.ts`, `apiWithHeaders` in `src/api/client.ts`, `src/components/paletteRegistry.ts`). From the worktree root, with the `node_modules` junction: `npx vitest run <file>`; `npx tsc -b`; `npx eslint <paths>`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/prefs/prefsStore.ts` (+ test, new) | the store: codecs per key, local read/write, debounced PATCH, session sync, subscriptions |
| `src/components/shell/ThemeProvider.tsx` (+ test, modify) | reads/writes through the store; adopts server values |
| `src/components/shell/useScope.ts` (modify) | memory through the store |
| `src/components/CommandPalette.tsx` (modify) | recents through the store |
| `src/prefs/SessionPrefs.tsx`, `src/prefs/LandingRedirect.tsx` (+ tests, new) | sync on auth; first-arrival redirect |
| `src/App.tsx`, `src/pages/LoginPage.tsx` (modify) | mount both; clear the landed flag on login |
| `src/components/settings/AppearanceCard.tsx` (+ test, modify) | Landing page select; synced line |
| `src/api/netWorth.ts`, `src/api/spending.ts` (+ tests, modify) | DELETEs return `{ batchId }`; repair source header |
| `src/pages/MonthlyUpdatePage.tsx` (+ test, modify) | Undo on the save and delete toasts |
| `src/components/settings/ActivityCard.tsx` (+ test, new) | the feed, Undo, View report, Load more |
| `src/components/settings/HealthCard.tsx` (+ test, new) | non-ok checks, link fixes, armed repair, snapshot now |
| `src/components/settings/settings.css` (modify) | activity/health rules |
| `src/pages/SettingsPage.tsx` (+ test, modify) | mount the two cards |

---

### Task 1: `prefsStore`

**Files:**
- Create: `src/prefs/prefsStore.ts`, `src/prefs/prefsStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/prefs/prefsStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setToken } from '../api/client'
import {
  PATCH_DEBOUNCE_MS,
  PREFS_SNAPSHOT,
  STORAGE_KEYS,
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/prefs/prefsStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```ts
// src/prefs/prefsStore.ts
import { getToken } from '../api/client'
import { fetchPrefs, patchPrefs } from '../api/prefs'
import { setSnapshot } from '../api/snapshotCache'
import type { PrefsOut } from '../types/api'

// Preferences that follow the account (2026-09-03 data-lifecycle spec §10), reconciled with
// the browser's copy by ONE rule: first paint from localStorage exactly as before; after
// /auth/me, GET /prefs once per session — a key the server lacks is seeded from the browser,
// a key the server has is adopted, unless the user changed it this session before the answer
// (then the browser wins and PATCHes up); every later change writes local synchronously and
// PATCHes debounced 400 ms per key; a failed PATCH retries on the next change or session and
// is never surfaced. The storage keys keep their old spellings so nothing is lost on deploy.

export type PrefKey = 'theme' | 'density' | 'scope' | 'palette_recents' | 'landing_page'
export type ThemeChoice = 'system' | 'dark' | 'light'
export type Density = 'comfortable' | 'compact'
export type RangePreset = 'all' | '1y' | 'ytd'
/** useScope's memory shape: owner null = the household ("all" on the wire). */
export interface ScopeMemory {
  owner?: number | 'joint' | null
  range?: RangePreset
}
export interface PrefValues {
  theme: ThemeChoice
  density: Density
  scope: ScopeMemory
  palette_recents: string[]
  landing_page: string
}

export const STORAGE_KEYS: Record<PrefKey, string> = {
  theme: 'finance.theme',
  density: 'finance.density',
  scope: 'finance.scope',
  palette_recents: 'commandPalette.recent',
  landing_page: 'finance.landingPage',
}
export const PREF_KEYS = Object.keys(STORAGE_KEYS) as PrefKey[]
export const PREFS_SNAPSHOT = 'shell:prefs'
export const PATCH_DEBOUNCE_MS = 400
const RECENTS_MAX = 8

interface Codec<V> {
  /** Storage string → value, undefined for garbage. */
  read: (raw: string | null) => V | undefined
  write: (value: V) => string
  /** Value → what PATCH /prefs sends. */
  toServer: (value: V) => unknown
  /** What GET /prefs holds → value, undefined for a shape this client does not know. */
  fromServer: (value: unknown) => V | undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPersonId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isRange = (v: unknown): v is RangePreset => v === 'all' || v === '1y' || v === 'ytd'
const isTheme = (v: unknown): v is ThemeChoice => v === 'system' || v === 'dark' || v === 'light'
const isDensity = (v: unknown): v is Density => v === 'comfortable' || v === 'compact'
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

const enumCodec = <V extends string>(guard: (v: unknown) => v is V): Codec<V> => ({
  read: (raw) => (guard(raw) ? raw : undefined),
  write: (value) => value,
  toServer: (value) => value,
  fromServer: (value) => (guard(value) ? value : undefined),
})

const codecs: { [K in PrefKey]: Codec<PrefValues[K]> } = {
  theme: enumCodec(isTheme),
  density: enumCodec(isDensity),
  scope: {
    // Light validation only: useScope validates the fields it reads (its own predicates).
    read: (raw) => {
      const parsed = parseJson(raw)
      return isRecord(parsed) ? (parsed as ScopeMemory) : undefined
    },
    write: (value) => JSON.stringify(value),
    toServer: (value) => ({
      owner: value.owner === null || value.owner === undefined ? 'all' : value.owner,
      range: value.range ?? '1y',
    }),
    fromServer: (value) => {
      if (!isRecord(value)) return undefined
      const owner =
        value.owner === 'all' ? null : value.owner === 'joint' ? 'joint' : isPersonId(value.owner) ? value.owner : undefined
      if (owner === undefined || !isRange(value.range)) return undefined
      return { owner, range: value.range }
    },
  },
  palette_recents: {
    read: (raw) => {
      const parsed = parseJson(raw)
      return isStringList(parsed) ? parsed : undefined
    },
    write: (value) => JSON.stringify(value),
    toServer: (value) => value.slice(0, RECENTS_MAX),
    fromServer: (value) => (isStringList(value) ? value.slice(0, RECENTS_MAX) : undefined),
  },
  landing_page: {
    read: (raw) => (raw !== null && raw.startsWith('/') ? raw : undefined),
    write: (value) => value,
    toServer: (value) => value,
    fromServer: (value) => (typeof value === 'string' && value.startsWith('/') ? value : undefined),
  },
}

// Module state — one store per tab. resetPrefsStoreForTests() clears it.
let synced = false
const dirty = new Set<PrefKey>() // changed this session before/after the server answered
const pending = new Map<PrefKey, unknown>() // server values awaiting a PATCH (debounced or failed)
const timers = new Map<PrefKey, ReturnType<typeof setTimeout>>()
const listeners = new Map<PrefKey, Set<(value: never) => void>>()
const syncedListeners = new Set<(synced: boolean) => void>()

function writeStorage(key: PrefKey, raw: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS[key], raw)
  } catch {
    // A blocked localStorage costs persistence, never the preference itself.
  }
}

export function getLocal<K extends PrefKey>(key: K): PrefValues[K] | undefined {
  try {
    return codecs[key].read(localStorage.getItem(STORAGE_KEYS[key]))
  } catch {
    return undefined
  }
}

/** The one write path: local synchronously, server debounced. Subscribers are NOT notified —
 *  the caller already holds the new value; notifications are for server ADOPTIONS. */
export function setLocal<K extends PrefKey>(key: K, value: PrefValues[K]): void {
  writeStorage(key, codecs[key].write(value))
  dirty.add(key)
  pending.set(key, codecs[key].toServer(value))
  const existing = timers.get(key)
  if (existing !== undefined) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      void flushPending()
    }, PATCH_DEBOUNCE_MS),
  )
}

/** Sends every pending key in one PATCH. Failures re-queue silently (spec §10 rule 4). */
async function flushPending(): Promise<void> {
  if (pending.size === 0 || getToken() === null) return
  const body = Object.fromEntries(pending)
  pending.clear()
  try {
    await patchPrefs(body)
  } catch {
    for (const [key, value] of Object.entries(body)) {
      if (!pending.has(key as PrefKey)) pending.set(key as PrefKey, value)
    }
  }
}

function adopt<K extends PrefKey>(key: K, value: PrefValues[K]): void {
  writeStorage(key, codecs[key].write(value))
  listeners.get(key)?.forEach((listener) => (listener as (v: PrefValues[K]) => void)(value))
}

/** Once per session, after /auth/me succeeds (SessionPrefs). Never throws. */
export async function syncFromServer(): Promise<void> {
  let out: PrefsOut
  try {
    out = await fetchPrefs()
  } catch {
    return // the browser's copy stands; the next session tries again
  }
  setSnapshot(PREFS_SNAPSHOT, out)
  const seed: Record<string, unknown> = {}
  for (const key of PREF_KEYS) {
    const server = out.prefs[key]
    const local = getLocal(key)
    if (server === undefined || dirty.has(key)) {
      // The server has nothing, or the user moved this key before the answer: the browser
      // seeds the account.
      if (local !== undefined) seed[key] = (codecs[key].toServer as (v: unknown) => unknown)(local)
      continue
    }
    const value = codecs[key].fromServer(server.value)
    if (value !== undefined) (adopt as (k: PrefKey, v: unknown) => void)(key, value)
  }
  for (const [key, value] of pending) seed[key] = value // earlier failed PATCHes ride along
  pending.clear()
  dirty.clear()
  synced = true
  syncedListeners.forEach((listener) => listener(true))
  if (Object.keys(seed).length > 0) {
    try {
      await patchPrefs(seed)
    } catch {
      for (const [key, value] of Object.entries(seed)) pending.set(key as PrefKey, value)
    }
  }
}

export function subscribe<K extends PrefKey>(key: K, listener: (value: PrefValues[K]) => void): () => void {
  const set = listeners.get(key) ?? new Set()
  set.add(listener as (value: never) => void)
  listeners.set(key, set)
  return () => {
    set.delete(listener as (value: never) => void)
  }
}

export function isSynced(): boolean {
  return synced
}

export function subscribeSynced(listener: (synced: boolean) => void): () => void {
  syncedListeners.add(listener)
  return () => {
    syncedListeners.delete(listener)
  }
}

export function resetPrefsStoreForTests(): void {
  synced = false
  dirty.clear()
  pending.clear()
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  listeners.clear()
  syncedListeners.clear()
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/prefs/prefsStore.test.ts`
Expected: PASS (9 tests). If the dirty-key test adopts `theme`, check that `setLocal` adds to `dirty` BEFORE the sync's per-key loop runs (it does: the loop runs after `await fetchPrefs()` resolves, and `setLocal` ran synchronously before `release`).

- [ ] **Step 5: Commit**

```bash
git add src/prefs/prefsStore.ts src/prefs/prefsStore.test.ts
git commit -m "feat(prefs): prefsStore — local mirror, debounced PATCH, session sync with seed/adopt/dirty rules"
```

---

### Task 2: Adoption — ThemeProvider, useScope, palette recents

**Files:**
- Modify: `src/components/shell/ThemeProvider.tsx`, `src/components/shell/ThemeProvider.test.tsx`, `src/components/shell/useScope.ts`, `src/components/CommandPalette.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/shell/ThemeProvider.test.tsx` (it already renders a `Probe` under `ThemeProvider` and clears `localStorage` in `beforeEach`; reuse its probe or render a minimal one):

```tsx
// A server value that lands after first paint (2026-09-03 data-lifecycle spec §10) moves the
// live state, not only storage — the shell re-renders for the signed-in state anyway.
it('adopts a theme and density synced from the server', async () => {
  vi.mock('../../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))
  const { fetchPrefs } = await import('../../api/prefs')
  const { resetPrefsStoreForTests, syncFromServer } = await import('../../prefs/prefsStore')
  resetPrefsStoreForTests()
  vi.mocked(fetchPrefs).mockResolvedValue({
    prefs: {
      theme: { value: 'light', updated_at: '2026-09-04T09:00:00+00:00' },
      density: { value: 'compact', updated_at: '2026-09-04T09:00:00+00:00' },
    },
  })
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  )
  expect(document.documentElement.dataset.theme).toBe('dark')
  await act(async () => {
    await syncFromServer()
  })
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.dataset.density).toBe('compact')
  expect(localStorage.getItem('finance.theme')).toBe('light')
})
```

(Hoist the `vi.mock('../../api/prefs', …)` call to the top of the file — vitest hoists it anyway, and the linter prefers it explicit. `Probe` is whatever the file's existing consumer component is called; if it has another name, use that.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/shell/ThemeProvider.test.tsx`
Expected: FAIL — the theme stays `dark` after the sync (the provider does not subscribe).

- [ ] **Step 3: Implement**

`src/components/shell/ThemeProvider.tsx`:
- add `import { getLocal, setLocal, subscribe } from '../../prefs/prefsStore'`;
- `readChoice()` becomes `return getLocal('theme') ?? 'dark'` and `readDensity()` becomes `return getLocal('density') ?? 'comfortable'` (drop their try/catch bodies — the store already swallows);
- delete `persist()`; in `setTheme` replace `persist(THEME_KEY, next)` with `setLocal('theme', next)`, in `setDensity` replace `persist(DENSITY_KEY, next)` with `setLocal('density', next)`;
- keep `THEME_KEY`/`DENSITY_KEY` exported (index.html's inline script and the tests pin them) — they equal `STORAGE_KEYS.theme`/`.density`;
- add, after the OS-follow effect:

```tsx
  // Server adoption (2026-09-03 data-lifecycle spec §10): a value synced after first paint
  // lands here. Storage is already written by the store; this moves the LIVE state.
  useEffect(() => {
    const offTheme = subscribe('theme', (next) => {
      setThemeState(next)
      applyResolved(resolveTheme(next))
    })
    const offDensity = subscribe('density', setDensityState)
    return () => {
      offTheme()
      offDensity()
    }
  }, [applyResolved])
```

- update the module comment: "Browser-local FIRST, then the account: prefsStore mirrors every change to the server and adopts the server's value at session start (data-lifecycle spec §10)."

`src/components/shell/useScope.ts`: add `import { getLocal, setLocal } from '../../prefs/prefsStore'`; in `readMemory()` replace `const parsed: unknown = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')` with `const parsed: unknown = getLocal('scope') ?? {}` (keep every validation line after it — the predicates stay useScope's); `writeMemory(next)` becomes `setLocal('scope', next)` (the store swallows storage errors). Keep `SCOPE_KEY` exported (tests pin it).

`src/components/CommandPalette.tsx`: add `import { getLocal, setLocal } from '../prefs/prefsStore'`; `readRecent()` becomes `return getLocal('palette_recents') ?? []`; `pushRecent(id)` becomes `setLocal('palette_recents', [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX))`. Delete `RECENT_KEY` (the store owns the spelling; the test pins `commandPalette.recent` through storage).

- [ ] **Step 4: Run the three consumers' suites**

Run: `npx vitest run src/components/shell/ThemeProvider.test.tsx src/components/shell/useScope.test.tsx src/components/shell/ScopeBar.test.tsx src/components/CommandPalette.test.tsx src/components/settings/AppearanceCard.test.tsx`
Expected: PASS — the pre-existing tests read the same storage keys and still hold.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/ThemeProvider.tsx src/components/shell/ThemeProvider.test.tsx src/components/shell/useScope.ts src/components/CommandPalette.tsx
git commit -m "feat(shell): theme, density, scope memory and palette recents read and write through prefsStore"
```

---

### Task 3: `SessionPrefs`, `LandingRedirect`, App wiring

**Files:**
- Create: `src/prefs/SessionPrefs.tsx`, `src/prefs/LandingRedirect.tsx`, `src/prefs/LandingRedirect.test.tsx`
- Modify: `src/App.tsx`, `src/pages/LoginPage.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/prefs/LandingRedirect.test.tsx
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToken } from '../api/client'
import LandingRedirect, { LANDED_KEY, clearLanded } from './LandingRedirect'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <LandingRedirect>
              <p>overview</p>
            </LandingRedirect>
          }
        />
        <Route path="/net-worth" element={<p>net worth</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setToken('tok')
})
afterEach(cleanup)

describe('LandingRedirect', () => {
  it('sends the first arrival of a session to the landing page, once', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    mount()
    expect(screen.getByText('net worth')).toBeTruthy()
    expect(sessionStorage.getItem(LANDED_KEY)).toBe('1')
    cleanup()
    mount()
    expect(screen.getByText('overview')).toBeTruthy() // Overview stays reachable
  })

  it('does nothing for the default landing page or without a session', () => {
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    localStorage.setItem('finance.landingPage', '/')
    sessionStorage.clear()
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    localStorage.setItem('finance.landingPage', '/net-worth')
    sessionStorage.clear()
    localStorage.removeItem('finance_token')
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
  })

  it('redirects again after clearLanded (a fresh login)', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    sessionStorage.setItem(LANDED_KEY, '1')
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    clearLanded()
    mount()
    expect(screen.getByText('net worth')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/prefs/LandingRedirect.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write both components and wire them**

```tsx
// src/prefs/SessionPrefs.tsx
import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { syncFromServer } from './prefsStore'

/** Runs the once-per-session preferences sync when the session becomes authenticated
 *  (2026-09-03 data-lifecycle spec §10 step 2) — i.e. after /auth/me has answered. Renders
 *  nothing; mounted inside AuthProvider in App.tsx. */
export default function SessionPrefs() {
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    if (isAuthenticated) void syncFromServer()
  }, [isAuthenticated])
  return null
}
```

```tsx
// src/prefs/LandingRedirect.tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { getToken } from '../api/client'
import { getLocal } from './prefsStore'

// The landing_page preference (2026-09-03 data-lifecycle spec §10): the FIRST arrival at `/`
// in a tab's session goes to the chosen page; every later visit to `/` is the Overview the
// user asked for by clicking it. Per tab (sessionStorage) so a reload never re-redirects, a
// new tab does, and the login clears the flag so a fresh sign-in lands there again.
export const LANDED_KEY = 'finance.landed'

export function clearLanded(): void {
  try {
    sessionStorage.removeItem(LANDED_KEY)
  } catch {
    // Storage blocked: the redirect simply never fires.
  }
}

/** The path to redirect to, or null — decided (and the flag set) exactly once per call. */
export function landingTarget(): string | null {
  if (getToken() === null) return null // no session: ProtectedRoute is about to redirect anyway
  let landed: string | null = null
  try {
    landed = sessionStorage.getItem(LANDED_KEY)
    sessionStorage.setItem(LANDED_KEY, '1')
  } catch {
    return null
  }
  if (landed !== null) return null
  const landing = getLocal('landing_page')
  return landing !== undefined && landing !== '/' ? landing : null
}

export default function LandingRedirect({ children }: { children: ReactNode }) {
  const [target] = useState(landingTarget) // once per mount, never re-evaluated on re-render
  return target === null ? <>{children}</> : <Navigate to={target} replace />
}
```

`src/App.tsx`: add `import LandingRedirect from './prefs/LandingRedirect'` and `import SessionPrefs from './prefs/SessionPrefs'`; inside `<AuthProvider>` before `<ToastProvider>` add `<SessionPrefs />`; change the `/` route to `<Route path="/" element={<LandingRedirect><OverviewPage /></LandingRedirect>} />`.

`src/pages/LoginPage.tsx`: add `import { clearLanded } from '../prefs/LandingRedirect'` and, immediately before `navigate(destination, { replace: true })` in the submit handler, add `clearLanded()` with the comment `// A fresh sign-in is a fresh arrival: the landing_page redirect applies once more.`

- [ ] **Step 4: Run the tests, type-check**

Run: `npx vitest run src/prefs src/pages/LoginPage.test.tsx src/components/Layout.test.tsx && npx tsc -b`
Expected: PASS; clean. (If a Layout/App-level test renders `<App />` and now sees `SessionPrefs` fetch, mock `../api/prefs` there like Task 1's test does.)

- [ ] **Step 5: Commit**

```bash
git add src/prefs/SessionPrefs.tsx src/prefs/LandingRedirect.tsx src/prefs/LandingRedirect.test.tsx src/App.tsx src/pages/LoginPage.tsx
git commit -m "feat(prefs): sync after sign-in; landing_page redirect once per tab session"
```

---

### Task 4: Appearance card — Landing page and the synced line

**Files:**
- Modify: `src/components/settings/AppearanceCard.tsx`, `src/components/settings/AppearanceCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/settings/AppearanceCard.test.tsx` (add `vi` and `waitFor` to the vitest/RTL imports, and hoist `vi.mock('../../api/prefs', () => ({ fetchPrefs: vi.fn(), patchPrefs: vi.fn(), deletePref: vi.fn() }))` to the top):

```tsx
  it('offers the landing page over the nav and remembers it through the store', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    const select = screen.getByLabelText('Landing page') as HTMLSelectElement
    expect(select.value).toBe('/')
    expect([...select.options].map((o) => o.textContent)).toContain('Net worth')
    fireEvent.change(select, { target: { value: '/net-worth' } })
    expect(localStorage.getItem('finance.landingPage')).toBe('/net-worth')
    expect(screen.getByText('Remembered in this browser; synced to your account once signed in.')).toBeTruthy()
  })

  it('says so once the server has answered', async () => {
    const { fetchPrefs } = await import('../../api/prefs')
    const { resetPrefsStoreForTests, syncFromServer } = await import('../../prefs/prefsStore')
    resetPrefsStoreForTests()
    vi.mocked(fetchPrefs).mockResolvedValue({ prefs: {} })
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    await syncFromServer()
    await waitFor(() => expect(screen.getByText('Synced to your account.')).toBeTruthy())
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/AppearanceCard.test.tsx`
Expected: FAIL — no `Landing page` control.

- [ ] **Step 3: Implement**

In `src/components/settings/AppearanceCard.tsx` add imports `import { useEffect, useState } from 'react'`, `import { getLocal, isSynced, setLocal, subscribe, subscribeSynced } from '../../prefs/prefsStore'`, `import { NAV_ITEMS } from '../navItems'`; inside the component:

```tsx
  const [landing, setLanding] = useState(() => getLocal('landing_page') ?? '/')
  const [synced, setSynced] = useState(isSynced)
  useEffect(() => subscribeSynced(setSynced), [])
  useEffect(() => subscribe('landing_page', setLanding), [])
```

and after the Density field:

```tsx
      <div className="settings-field">
        <label className="eyebrow" htmlFor="landing-page">
          Landing page
        </label>
        <select
          id="landing-page"
          className="field-input"
          value={landing}
          onChange={(e) => {
            setLanding(e.target.value)
            setLocal('landing_page', e.target.value)
          }}
        >
          {NAV_ITEMS.map((item) => (
            <option key={item.to} value={item.to}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-note">
        {synced ? 'Synced to your account.' : 'Remembered in this browser; synced to your account once signed in.'}
      </p>
```

replacing the old `<p className="settings-note">Remembered in this browser only.</p>`. Update the InfoHint text to: `"Theme, density and your landing page. They paint from this browser first and follow your account once signed in — a second browser picks them up at its next sign-in. System follows your operating system's light or dark setting live."`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/settings/AppearanceCard.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AppearanceCard.tsx src/components/settings/AppearanceCard.test.tsx
git commit -m "feat(settings): Appearance card — landing page pick and the synced-to-account line"
```

---

### Task 5: The month DELETE fetchers read `X-Change-Batch`; the wizard's toasts gain Undo

**Files:**
- Modify: `src/api/netWorth.ts`, `src/api/netWorth.test.ts`, `src/api/spending.ts` (+ create `src/api/spending.test.ts` if absent), `src/pages/MonthlyUpdatePage.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/api/netWorth.test.ts` (add `apiWithHeaders: vi.fn()` to its `vi.mock('./client', …)` factory and import it):

```ts
it('deleteMonthBalances reads the change batch from the 204 header', async () => {
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: undefined,
    headers: new Headers({ 'X-Change-Batch': 'b-nw' }),
  })
  expect(await deleteMonthBalances('2026-09-01')).toEqual({ batchId: 'b-nw' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual(['/net-worth/months/2026-09-01', { method: 'DELETE' }])
  vi.mocked(apiWithHeaders).mockResolvedValue({ data: undefined, headers: new Headers() })
  expect(await deleteMonthBalances('2026-09-01')).toEqual({ batchId: null })
})
```

Create `src/api/spending.test.ts` (or append if it exists):

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { deleteSpendingMonth } from './spending'

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
  apiWithHeaders: vi.fn(),
}))
import { apiWithHeaders } from './client'

beforeEach(() => vi.clearAllMocks())

it('deleteSpendingMonth reads the change batch and sends the repair source only when asked', async () => {
  vi.mocked(apiWithHeaders).mockResolvedValue({
    data: undefined,
    headers: new Headers({ 'X-Change-Batch': 'b-sp' }),
  })
  expect(await deleteSpendingMonth('2026-09-01')).toEqual({ batchId: 'b-sp' })
  expect(vi.mocked(apiWithHeaders).mock.calls[0]).toEqual(['/spending/months/2026-09-01', { method: 'DELETE' }])
  await deleteSpendingMonth('2026-09-01', { source: 'repair' })
  expect(vi.mocked(apiWithHeaders).mock.calls[1]).toEqual([
    '/spending/months/2026-09-01',
    { method: 'DELETE', headers: { 'X-Change-Source': 'repair' } },
  ])
})
```

In `src/pages/MonthlyUpdatePage.test.tsx`: add `vi.mock('../api/lifecycle', () => ({ undoBatch: vi.fn() }))` beside the other mocks and `import * as lifecycleApi from '../api/lifecycle'`; change the delete test's mock `vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue(undefined)` to `.mockResolvedValue({ batchId: 'b-nw' })`; then append:

```tsx
// --- undo (2026-09-03 data-lifecycle spec §9) ---------------------------------------------

it('the delete toast carries Undo, which undoes the spending batch then the balances batch and returns to the month', async () => {
  vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue({ batchId: 'b-nw' })
  vi.mocked(spendingApi.deleteSpendingMonth).mockResolvedValue({ batchId: 'b-sp' })
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-1', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Jul 2026 spending', month: '2026-07-01', rows: 2, undoable: true, undone_by: null,
  })
  renderWizardAt('/update?month=2026-07-01&step=review')
  const button = (await screen.findByRole('button', { name: 'Delete this month' })) as HTMLButtonElement
  fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
  fireEvent.click(button)
  await screen.findByText(`Deleted ${formatMonth('2026-07-01')} — balances and spending removed.`)
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledTimes(2))
  expect(vi.mocked(lifecycleApi.undoBatch).mock.calls.map((c) => c[0])).toEqual(['b-sp', 'b-nw'])
  await screen.findByText('Undone — Jul 2026 is back.')
  // Back on the undone month's wizard.
  await waitFor(() => expect(netWorthApi.fetchMonthBalances).toHaveBeenLastCalledWith('2026-07-01'))
})

it('a 404 leg leaves no batch to undo, so Undo only fires the leg that wrote', async () => {
  vi.mocked(netWorthApi.deleteMonthBalances).mockResolvedValue({ batchId: 'b-nw' })
  vi.mocked(spendingApi.deleteSpendingMonth).mockRejectedValue(
    new ApiError('no spending or net pay recorded for this month', 404),
  )
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-1', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Jul 2026 balances', month: '2026-07-01', rows: 2, undoable: true, undone_by: null,
  })
  renderWizardAt('/update?month=2026-07-01&step=review')
  await screen.findByRole('button', { name: 'Delete this month' })
  fireEvent.change(screen.getByLabelText('Type 2026-07 to confirm'), { target: { value: '2026-07' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete this month' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledTimes(1))
  expect(lifecycleApi.undoBatch).toHaveBeenCalledWith('b-nw')
})

it('the save toast carries Undo when a batch was written, and fires spending then balances', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
    month: '2026-08-01', snapshot_created: true, created: 1, updated: 0, unchanged: 0, batch_id: 'b-nw2',
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 1, updated: 0, unchanged: 0, net_pay_set: true, net_pay_cleared: false, batch_id: 'b-sp2',
  })
  vi.mocked(lifecycleApi.undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-2', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Entered Aug 2026 balances — 1 accounts', month: '2026-08-01', rows: 2, undoable: true, undone_by: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(screen.getByText('Saved Aug 2026 — 1 balances updated')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(lifecycleApi.undoBatch).toHaveBeenCalledTimes(2))
  expect(vi.mocked(lifecycleApi.undoBatch).mock.calls.map((c) => c[0])).toEqual(['b-sp2', 'b-nw2'])
  await screen.findByText('Undone — Aug 2026 is back to how it was.')
})

it('an all-unchanged save toasts nothing and offers no Undo', async () => {
  vi.mocked(netWorthApi.putMonthBalances).mockResolvedValue({
    month: '2026-08-01', snapshot_created: false, created: 0, updated: 0, unchanged: 1, batch_id: null,
  })
  vi.mocked(spendingApi.putSpendingMonth).mockResolvedValue({
    month: '2026-08-01', created: 0, updated: 0, unchanged: 1, net_pay_set: false, net_pay_cleared: false, batch_id: null,
  })
  renderWizardAt('/update?month=2026-08-01')
  await screen.findByLabelText('Checking')
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  await screen.findByLabelText('Food')
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await screen.findByText(/month saved/i)
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/api/netWorth.test.ts src/api/spending.test.ts src/pages/MonthlyUpdatePage.test.tsx`
Expected: FAIL — the fetchers return `undefined`; no Undo button.

- [ ] **Step 3: Implement**

`src/api/netWorth.ts` — import `apiWithHeaders` beside `api`; replace `deleteMonthBalances`:

```ts
// 404 when the month has no snapshot — the wizard delete treats that as "already gone". The
// 204 carries the change batch in X-Change-Batch (2026-09-03 data-lifecycle spec §9); null
// when nothing was logged, so the caller offers no Undo.
export async function deleteMonthBalances(month: string): Promise<{ batchId: string | null }> {
  const { headers } = await apiWithHeaders<void>(`/net-worth/months/${month}`, { method: 'DELETE' })
  return { batchId: headers.get('x-change-batch') }
}
```

`src/api/spending.ts` — same import; replace `deleteSpendingMonth`:

```ts
// 404 when the month has neither spending rows nor a cashflow row — "already gone". The 204
// carries the change batch (spec §9). `source: 'repair'` is the Data-health card's zero-month
// fix: the server logs the batch as a repair (still undoable) instead of a UI delete.
export async function deleteSpendingMonth(
  month: string,
  options: { source?: 'repair' } = {},
): Promise<{ batchId: string | null }> {
  const { headers } = await apiWithHeaders<void>(`/spending/months/${month}`, {
    method: 'DELETE',
    ...(options.source === undefined ? {} : { headers: { 'X-Change-Source': options.source } }),
  })
  return { batchId: headers.get('x-change-batch') }
}
```

`src/pages/MonthlyUpdatePage.tsx`:

- add `import { undoBatch } from '../api/lifecycle'`;
- make `tolerate404` generic:

```ts
  const tolerate404 = async <T,>(call: Promise<T>): Promise<T | null> => {
    try {
      return await call
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
```

- add, above `save`, the shared undo runner:

```ts
  // Undo (2026-09-03 data-lifecycle spec §9): the spending batch, then the balances batch —
  // the reverse of the save's order — each its own request; the first failure stops the
  // sequence and its sentence is shown. `after` runs on success (reload, or return to the month).
  const undoBatches = async (batchIds: (string | null)[], done: string, after: () => void) => {
    try {
      for (const id of batchIds) if (id !== null) await undoBatch(id)
      toast.success(done)
      after()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Undo failed')
    }
  }
```

- in `save()`, right after `setBalancesLeg(null)` and the `setSaved(...)` call, add:

```ts
      const saveBatches = [spendResult.batch_id ?? null, balanceResult.batch_id ?? null]
      if (saveBatches.some((id) => id !== null)) {
        toast.success(
          `Saved ${formatMonth(month)} — ${balanceResult.created + balanceResult.updated} balances updated`,
          {
            action: {
              label: 'Undo',
              onAction: () =>
                void undoBatches(saveBatches, `Undone — ${formatMonth(month)} is back to how it was.`, () => {
                  setLoading(true)
                  setLoadNonce((n) => n + 1)
                }),
            },
          },
        )
      }
```

- in `deleteMonth()`, replace the two `await tolerate404(...)` lines and the toast with:

```ts
      // Named *Delete, not *Leg: `balancesLeg` is already this component's remembered
      // half-landed SAVE (the A8 retry), and shadowing it here would read as the same thing.
      const balancesDelete = await tolerate404(deleteMonthBalances(month))
      const spendingDelete = await tolerate404(deleteSpendingMonth(month))
      sessionStorage.removeItem(draftKey(month))
      const deleted = month
      const deleteBatches = [spendingDelete?.batchId ?? null, balancesDelete?.batchId ?? null]
      toast.success(
        `Deleted ${formatMonth(month)} — balances and spending removed.`,
        deleteBatches.some((id) => id !== null)
          ? {
              action: {
                label: 'Undo',
                onAction: () =>
                  void undoBatches(deleteBatches, `Undone — ${formatMonth(deleted)} is back.`, () => {
                    // Back to the undone month's wizard; the nonce covers the same-month case.
                    setLoading(true)
                    setLoadNonce((n) => n + 1)
                    setParams(() => new URLSearchParams({ month: deleted, step: 'balances' }))
                  }),
              },
            }
          : undefined,
      )
```

(The rest of `deleteMonth` — `setDeleteArm('')` through the navigation to the current month — stays as it is.)

- update the Danger zone copy: `Delete this month everywhere: its balances snapshot, spending rows and take-home. Undo is offered for six seconds afterwards, and the Activity card can undo it later.`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/api/netWorth.test.ts src/api/spending.test.ts src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS (the pre-existing wizard tests still hold: the save toast appears only when a `batch_id` is set, and the default mocks in `beforeEach` set none — if `screen.getByText(/month saved/i)` now finds two nodes in an older test, tighten it to the green banner's role).

- [ ] **Step 5: Commit**

```bash
git add src/api/netWorth.ts src/api/netWorth.test.ts src/api/spending.ts src/api/spending.test.ts src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(wizard): save and delete toasts carry Undo — spending batch then balances batch; DELETEs read X-Change-Batch"
```

---

### Task 6: `ActivityCard`

**Files:**
- Create: `src/components/settings/ActivityCard.tsx`, `src/components/settings/ActivityCard.test.tsx`
- Modify: `src/components/settings/settings.css`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/ActivityCard.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { ActivityBatch, ActivityPage, ActivityRun } from '../../types/api'
import ToastProvider from '../ToastProvider'
import ActivityCard from './ActivityCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchActivity: vi.fn(),
  fetchActivityRun: vi.fn(),
  undoBatch: vi.fn(),
}))
import { fetchActivity, fetchActivityRun, undoBatch } from '../../api/lifecycle'

const SAVE: ActivityBatch = {
  type: 'batch', batch_id: 'b-1', at: '2026-09-04T09:00:00+00:00', source: 'ui', actor: 'me@example.com',
  label: 'Saved Sep 2026 balances — 19 updated', month: '2026-09-01', rows: 19, undoable: true, undone_by: null,
}
const RESTORE_RUN: ActivityRun = {
  type: 'run', run_id: 7, at: '2026-09-03T23:30:00+00:00', kind: 'restore', ok: true, dry_run: false,
  filename: 'finance-export-20260902-233000.zip', size_bytes: 2_097_152, has_report: true,
}
const IMPORT_RUN: ActivityRun = { ...RESTORE_RUN, run_id: 8, kind: 'import_xlsx', filename: 'finances.xlsx', at: '2026-09-02T09:00:00+00:00' }
const SUMMARY: ActivityBatch = {
  ...SAVE, batch_id: 'b-0', source: 'restore', label: 'Restored snapshot from Sep 2, 2026', rows: 0, undoable: false, at: '2026-09-01T09:00:00+00:00',
}

function page(entries: ActivityPage['entries'], next_before: string | null = null): ActivityPage {
  return { entries, next_before }
}

function mount() {
  return render(
    <ToastProvider>
      <ActivityCard />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchActivity).mockResolvedValue(page([SAVE, RESTORE_RUN, IMPORT_RUN, SUMMARY]))
  vi.mocked(undoBatch).mockResolvedValue({ ...SAVE, batch_id: 'u-1', source: 'undo', label: 'Undid: Saved Sep 2026 balances — 19 updated' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ActivityCard', () => {
  it('lists batches and runs with source pills, and offers Undo only where undoable', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Activity' })).toBeTruthy()
    expect(document.getElementById('activity')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Saved Sep 2026 balances — 19 updated')
    expect(rows[0].querySelector('.activity-source')?.textContent).toBe('ui')
    expect(rows[1].textContent).toContain('Restore · finance-export-20260902-233000.zip')
    expect(rows[3].querySelector('.activity-source')?.textContent).toBe('restore')
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'View report' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('Undo arms on the first click and fires on the second, then toasts and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(undoBatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo?' }))
    await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-1'))
    expect(await screen.findByText('Undone — Saved Sep 2026 balances — 19 updated')).toBeTruthy()
    await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2))
  })

  it('shows a refusal verbatim in the banner', async () => {
    vi.mocked(undoBatch).mockRejectedValue(new ApiError('Later changes touched these rows — undo those first', 409))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo?' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Later changes touched these rows — undo those first')
  })

  it('View report renders a restore report and an import report through their views', async () => {
    vi.mocked(fetchActivityRun).mockImplementation(async (runId: number) =>
      runId === 7
        ? {
            run: RESTORE_RUN,
            report: {
              dry_run: false, applied: true, exported_at: '2026-09-02T23:30:00+00:00',
              schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
              tables: { accounts: { current: 25, incoming: 25, identical: true } },
              preserved_settings: [], warnings: [], errors: [], restore_point: 'pre-restore-x.zip', batch_id: 'b-0', run_id: 7,
            },
          }
        : {
            run: IMPORT_RUN,
            report: { dry_run: false, applied: true, sheets: { spending: { entities: { transaction: { creates: 2, updates: 0, skips: 0, deletes: 0 } }, warnings: [], errors: [], samples: [], samples_truncated: 0 } } },
          },
    )
    mount()
    const [restoreView, importView] = await screen.findAllByRole('button', { name: 'View report' })
    fireEvent.click(restoreView)
    expect(await screen.findByText('Restored.')).toBeTruthy()
    expect(screen.getByText('1 table unchanged')).toBeTruthy()
    fireEvent.click(importView)
    expect(await screen.findByText('Applied.')).toBeTruthy()
    expect(screen.getByText('transaction')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
    expect(screen.queryByText('Applied.')).toBeNull()
  })

  it('Load more appends the next page using the cursor', async () => {
    vi.mocked(fetchActivity)
      .mockResolvedValueOnce(page([SAVE, RESTORE_RUN], '2026-09-03T23:30:00+00:00'))
      .mockResolvedValueOnce(page([IMPORT_RUN, SUMMARY]))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    expect(vi.mocked(fetchActivity).mock.calls[1][0]).toBe('2026-09-03T23:30:00+00:00')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/ActivityCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card and its styles**

```tsx
// src/components/settings/ActivityCard.tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchActivity, fetchActivityRun, undoBatch } from '../../api/lifecycle'
import type { ActivityEntry, ActivityRun, ActivityRunDetail, ImportReport, RestoreReport } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import ImportReportView from './ImportReportView'
import RestoreReportView from './RestoreReportView'
import '../panels.css'
import './settings.css'

const RUN_LABELS: Record<ActivityRun['kind'], string> = {
  import_xlsx: 'Import',
  restore: 'Restore',
  snapshot: 'Snapshot',
  restore_point: 'Restore point',
  undo: 'Undo',
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function runLine(run: ActivityRun): string {
  const parts = [RUN_LABELS[run.kind] ?? run.kind]
  if (run.dry_run) parts.push('dry run')
  if (!run.ok) parts.push('failed')
  if (run.filename) parts.push(run.filename)
  if (run.size_bytes != null) parts.push(formatBytes(run.size_bytes))
  return parts.join(' · ')
}

function ReportBody({ detail }: { detail: ActivityRunDetail }) {
  if (detail.report === null) return <p className="settings-note">No report was stored for this run.</p>
  if (detail.run.kind === 'import_xlsx') return <ImportReportView report={detail.report as unknown as ImportReport} />
  if (detail.run.kind === 'restore') return <RestoreReportView report={detail.report as unknown as RestoreReport} />
  return <pre className="activity-raw">{JSON.stringify(detail.report, null, 2)}</pre>
}

/**
 * Activity (2026-09-03 data-lifecycle spec §9): the change log and the run trail as one
 * feed, newest first — every money-bearing write with its label, source and Undo where the
 * server says it is cheap (arm on click, not typed: an undo is itself reversible), plus the
 * stored import and restore reports that used to evaporate with React state.
 */
export default function ActivityCard() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null) // the batch id whose Undo is armed
  const [detail, setDetail] = useState<ActivityRunDetail | null>(null)
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchActivity()
      .then((pageOut) => {
        if (seq !== seqRef.current) return
        setEntries(pageOut.entries)
        setNextBefore(pageOut.next_before)
        setError(null)
        setArmed(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load activity.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const loadMore = () => {
    if (nextBefore === null) return
    setBusy(true)
    fetchActivity(nextBefore)
      .then((pageOut) => {
        setEntries((current) => [...(current ?? []), ...pageOut.entries])
        setNextBefore(pageOut.next_before)
      })
      .catch((err: unknown) => setError(message(err, 'Could not load more activity.')))
      .finally(() => setBusy(false))
  }

  const undo = (batchId: string, label: string) => {
    if (armed !== batchId) {
      setArmed(batchId) // first click arms; a click elsewhere disarms via load()
      return
    }
    setBusy(true)
    setError(null)
    undoBatch(batchId)
      .then(() => {
        toast.success(`Undone — ${label}`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Undo failed.')))
      .finally(() => setBusy(false))
  }

  const viewReport = (runId: number) => {
    setBusy(true)
    fetchActivityRun(runId)
      .then(setDetail)
      .catch((err: unknown) => setError(message(err, 'Could not load the report.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="activity" role="region" aria-label="Activity">
      <h2 className="eyebrow">
        Activity
        <InfoHint text="Every money-bearing change — month saves and deletes, account, category and budget edits, imports, restores, snapshots — newest first. Undo replays one change in reverse while nothing later touched the same rows; imports and restores are summaries and are undone by restoring a snapshot instead." />
      </h2>
      <FeedBanner error={error} retry={load} retryLabel="Retry loading activity" />
      {entries === null && error === null && <p className="empty-note">Loading…</p>}
      {entries !== null && entries.length === 0 && <p className="empty-note">Nothing recorded yet.</p>}
      {entries !== null && entries.length > 0 && (
        <ul className="activity-list">
          {entries.map((entry) =>
            entry.type === 'batch' ? (
              <li key={`b:${entry.batch_id}`} className="activity-row">
                <span className="settings-note">{formatDateTime(entry.at)}</span>
                <span className={`badge activity-source activity-source-${entry.source}`}>{entry.source}</span>
                <span className="activity-label">{entry.label}</span>
                {entry.undone_by !== null && <span className="settings-note">undone</span>}
                {entry.undoable && (
                  <button
                    type="button"
                    className={`button${armed === entry.batch_id ? ' danger-button' : ''}`}
                    disabled={busy}
                    onClick={() => undo(entry.batch_id, entry.label)}
                  >
                    {armed === entry.batch_id ? 'Undo?' : 'Undo'}
                  </button>
                )}
              </li>
            ) : (
              <li key={`r:${entry.run_id}`} className="activity-row">
                <span className="settings-note">{formatDateTime(entry.at)}</span>
                <span className={`badge activity-source activity-source-run${entry.ok ? '' : ' is-failed'}`}>run</span>
                <span className="activity-label">{runLine(entry)}</span>
                {entry.has_report && (
                  <button type="button" className="button" disabled={busy} onClick={() => viewReport(entry.run_id)}>
                    View report
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {nextBefore !== null && (
        <button type="button" className="button" disabled={busy} onClick={loadMore}>
          Load more
        </button>
      )}
      {detail !== null && (
        <div className="activity-report">
          <div className="settings-card-actions">
            <span className="eyebrow">{runLine(detail.run)}</span>
            <button type="button" className="button" onClick={() => setDetail(null)}>
              Close report
            </button>
          </div>
          <ReportBody detail={detail} />
        </div>
      )}
    </section>
  )
}
```

Append to `src/components/settings/settings.css`:

```css
/* --- activity and data health cards (2026-09-03 data-lifecycle spec §9, §11) --- */

.activity-list,
.health-list {
  list-style: none;
  margin: 0.5rem 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.activity-row,
.health-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.6rem;
}

.activity-row .button,
.health-row .button {
  margin-left: auto;
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
}

.activity-label,
.health-title {
  font-size: 0.85rem;
  color: var(--text);
}

/* Source pills: one hue per writer, the text always says the word too. */
.activity-source {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.activity-source-repair,
.activity-source-undo {
  color: var(--warn);
}

.activity-source-restore,
.activity-source-import {
  color: var(--chart-3);
}

.activity-source.is-failed {
  color: var(--negative);
}

.activity-report {
  margin-top: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}

.activity-raw {
  font-size: 0.75rem;
  overflow: auto;
  max-height: 320px;
}

/* Severity words with their tones; the word is always printed (colour never alone). */
.health-severity-error {
  color: var(--negative);
}

.health-severity-warn {
  color: var(--warn);
}

.health-severity-info {
  color: var(--muted);
}

.health-detail {
  flex-basis: 100%;
  margin: 0;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/settings/ActivityCard.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ActivityCard.tsx src/components/settings/ActivityCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): Activity card — feed with source pills, armed Undo, stored reports, Load more"
```

---

### Task 7: `HealthCard`

**Files:**
- Create: `src/components/settings/HealthCard.tsx`, `src/components/settings/HealthCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/HealthCard.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { HealthCheck, HealthOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import HealthCard from './HealthCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchHealth: vi.fn(),
  createSnapshot: vi.fn(),
  undoBatch: vi.fn(),
}))
vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  deleteSpendingMonth: vi.fn(),
}))
import { createSnapshot, fetchHealth, undoBatch } from '../../api/lifecycle'
import { deleteSpendingMonth } from '../../api/spending'

const OK: HealthCheck = { id: 'stale_quotes', severity: 'ok', title: 'Quotes are fresh', detail: '', count: 0, months: [], fix: null }
const ZERO: HealthCheck = {
  id: 'zero_filled_spending', severity: 'error', title: 'Zero-filled spending month',
  detail: 'Sep 2026: every category is $0.00 and no take-home was entered — an empty month that reads as spending nothing.',
  count: 1, months: ['2026-09-01'],
  fix: { kind: 'action', action: 'delete_spending_month', label: 'Delete the zero-filled month' },
}
const GAP: HealthCheck = {
  id: 'balances_without_spending', severity: 'warn', title: 'Balances entered, spending missing',
  detail: 'Aug 2026: balances were saved but no spending row exists.', count: 1, months: ['2026-08-01'],
  fix: { kind: 'link', to: '/update?month=2026-08-01&step=spending', label: 'Enter Aug 2026 spending' },
}
const SNAP: HealthCheck = {
  id: 'snapshot', severity: 'warn', title: 'No stored snapshot yet', detail: 'The nightly snapshot has not written a file to the data volume.',
  count: 1, months: [], fix: { kind: 'action', action: 'snapshot_now', label: 'Snapshot now' },
}

function health(checks: HealthCheck[]): HealthOut {
  return { checked_at: '2026-09-04T09:00:00+00:00', checks }
}

function mount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HealthCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchHealth).mockResolvedValue(health([OK, ZERO, GAP, SNAP]))
  vi.mocked(deleteSpendingMonth).mockResolvedValue({ batchId: 'b-repair' })
  vi.mocked(createSnapshot).mockResolvedValue({ name: 'finance-export-20260904-091500.zip', at: '2026-09-04T09:15:00+00:00', size_bytes: 1, alembic_head: null, restorable: true })
  vi.mocked(undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-1', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Sep 2026 spending', month: '2026-09-01', rows: 19, undoable: true, undone_by: null,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HealthCard', () => {
  it('lists the non-ok checks with their severity in words and a link fix as a link', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Data health' })).toBeTruthy()
    expect(document.getElementById('health')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('error')
    expect(rows[0].textContent).toContain('Zero-filled spending month')
    expect(screen.queryByText('Quotes are fresh')).toBeNull()
    const link = screen.getByRole('link', { name: 'Enter Aug 2026 spending' })
    expect(link.getAttribute('href')).toBe('/update?month=2026-08-01&step=spending')
  })

  it('the repair arms on click, runs as a repair, toasts with Undo, and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Sep 2026' }))
    expect(deleteSpendingMonth).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sep 2026?' }))
    await waitFor(() => expect(deleteSpendingMonth).toHaveBeenCalledWith('2026-09-01', { source: 'repair' }))
    expect(await screen.findByText("Deleted Sep 2026's zero-filled rows")).toBeTruthy()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-repair'))
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(3))
  })

  it('Snapshot now runs the snapshot action and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Snapshot now' }))
    await waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Snapshot written — finance-export-20260904-091500.zip')).toBeTruthy()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))
  })

  it('shows a failed repair verbatim and says when everything passes', async () => {
    vi.mocked(deleteSpendingMonth).mockRejectedValue(new ApiError('no spending or net pay recorded for this month', 404))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Sep 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sep 2026?' }))
    expect((await screen.findByRole('alert')).textContent).toContain('no spending or net pay recorded for this month')
    cleanup()
    vi.mocked(fetchHealth).mockResolvedValue(health([OK]))
    mount()
    expect(await screen.findByText('All checks pass.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/HealthCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card**

```tsx
// src/components/settings/HealthCard.tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchHealth, undoBatch } from '../../api/lifecycle'
import { deleteSpendingMonth } from '../../api/spending'
import type { HealthCheck } from '../../types/api'
import { formatMonth } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Data health (2026-09-03 data-lifecycle spec §11): the server's checks, non-ok ones only,
 * each with its fix — a link into the app, or an action run from here. The zero-month repair
 * is the spending DELETE sent as a repair (logged, undoable): arm on click, run, toast with
 * Undo, refetch. Production's phantom September becomes two clicks.
 */
export default function HealthCard() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null) // `${check.id}:${month}` awaiting its second click
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchHealth()
      .then((out) => {
        if (seq !== seqRef.current) return
        setChecks(out.checks.filter((check) => check.severity !== 'ok'))
        setError(null)
        setArmed(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the health checks.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const repairMonth = (check: HealthCheck, month: string) => {
    const key = `${check.id}:${month}`
    if (armed !== key) {
      setArmed(key)
      return
    }
    setBusy(true)
    setError(null)
    deleteSpendingMonth(month, { source: 'repair' })
      .then(({ batchId }) => {
        toast.success(
          `Deleted ${formatMonth(month)}'s zero-filled rows`,
          batchId === null
            ? undefined
            : {
                action: {
                  label: 'Undo',
                  onAction: () =>
                    void undoBatch(batchId)
                      .then(() => {
                        toast.success(`Undone — ${formatMonth(month)}'s rows are back`)
                        load()
                      })
                      .catch((err: unknown) => toast.error(message(err, 'Undo failed'))),
                },
              },
        )
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Repair failed.')))
      .finally(() => setBusy(false))
  }

  const snapshotNow = () => {
    setBusy(true)
    setError(null)
    createSnapshot()
      .then((entry) => {
        toast.success(`Snapshot written — ${entry.name}`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Snapshot failed.')))
      .finally(() => setBusy(false))
  }

  const fixFor = (check: HealthCheck) => {
    const fix = check.fix
    if (fix === null) return null
    if (fix.kind === 'link' && fix.to) {
      return (
        <Link className="button" to={fix.to}>
          {fix.label}
        </Link>
      )
    }
    if (fix.action === 'delete_spending_month') {
      return check.months.map((month) => {
        const key = `${check.id}:${month}`
        return (
          <button
            key={month}
            type="button"
            className={`button${armed === key ? ' danger-button' : ''}`}
            disabled={busy}
            onClick={() => repairMonth(check, month)}
          >
            {armed === key ? `Delete ${formatMonth(month)}?` : `Delete ${formatMonth(month)}`}
          </button>
        )
      })
    }
    if (fix.action === 'snapshot_now') {
      return (
        <button type="button" className="button" disabled={busy} onClick={snapshotNow}>
          {fix.label}
        </button>
      )
    }
    return null
  }

  return (
    <section className="card span-6" id="health" role="region" aria-label="Data health">
      <h2 className="eyebrow">
        Data health
        <InfoHint text="Checks the server runs on every visit: zero-filled spending months, balances or spending entered without the other, stale quotes, two identical months, the backup marker and the stored snapshots. Each names its fix; the zero-month repair is a logged, undoable delete." />
      </h2>
      <FeedBanner error={error} retry={load} retryLabel="Retry the health checks" />
      {checks === null && error === null && <p className="empty-note">Loading…</p>}
      {checks !== null && checks.length === 0 && <p className="empty-note">All checks pass.</p>}
      {checks !== null && checks.length > 0 && (
        <ul className="health-list">
          {checks.map((check) => (
            <li key={check.id} className="health-row">
              <span className={`badge health-severity-${check.severity}`}>{check.severity}</span>
              <span className="health-title">{check.title}</span>
              {fixFor(check)}
              <p className="settings-note health-detail">{check.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/settings/HealthCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/HealthCard.tsx src/components/settings/HealthCard.test.tsx
git commit -m "feat(settings): Data health card — non-ok checks, link fixes, armed repair with Undo, snapshot now"
```

---

### Task 8: Mount the two cards on the Settings page

**Files:**
- Modify: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/pages/SettingsPage.test.tsx` add, beside the other `vi.mock` blocks:

```ts
// The Health and Activity cards (2026-09-03 data-lifecycle spec §9, §11) each own a fetch;
// unmocked they would hit the network from every test in this file.
vi.mock('../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lifecycle')>()),
  fetchActivity: vi.fn(),
  fetchActivityRun: vi.fn(),
  undoBatch: vi.fn(),
  fetchHealth: vi.fn(),
  createSnapshot: vi.fn(),
}))
import { fetchActivity, fetchHealth } from '../api/lifecycle'
```

with `vi.mocked(fetchActivity).mockResolvedValue({ entries: [], next_before: null })` and `vi.mocked(fetchHealth).mockResolvedValue({ checked_at: '2026-09-04T09:00:00+00:00', checks: [] })` in `beforeEach`, and a new describe:

```ts
describe('SettingsPage — health and activity cards', () => {
  it('mounts Data health then Activity directly before the App settings card', async () => {
    render(<SettingsPage />)  // the file's router-wrapped render helper
    const health = await screen.findByRole('region', { name: 'Data health' })
    const activity = screen.getByRole('region', { name: 'Activity' })
    const appSettings = document.getElementById('app-settings')
    expect(health.nextElementSibling).toBe(activity)
    expect(activity.nextElementSibling).toBe(appSettings)
    await waitFor(() => expect(vi.mocked(fetchHealth)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fetchActivity)).toHaveBeenCalledTimes(1)
  })

  it('offers neither card when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    render(<SettingsPage />)
    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Data health' })).toBeNull()
    expect(vi.mocked(fetchHealth)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — no region named "Data health".

- [ ] **Step 3: Implement**

In `src/pages/SettingsPage.tsx` add `import ActivityCard from '../components/settings/ActivityCard'` and `import HealthCard from '../components/settings/HealthCard'`, and immediately BEFORE the `<section className="card span-6" id="app-settings">` block add:

```tsx
          {/* Data health, then Activity (2026-09-03 data-lifecycle spec §9, §11): what is wrong
              with the data and what changed it — beside the backup cards, ahead of the forms.
              Own fetches, the page's loadedOnce gate. */}
          <HealthCard />
          <ActivityCard />
```

- [ ] **Step 4: Run the tests, type-check, lint**

Run: `npx vitest run src/pages/SettingsPage.test.tsx && npx tsc -b && npx eslint src/prefs src/components/settings src/components/shell src/components/CommandPalette.tsx src/pages src/api src/App.tsx`
Expected: all green, clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): mount Data health and Activity cards"
```

---

### Task 9: Whole frontend suite

- [ ] **Step 1:** `npx tsc -b && npx eslint . && npx vitest run` → clean, all green.

---

## Merge notes for the coordinator

- `src/pages/SettingsPage.tsx` / `.test.tsx`: F1 inserts `<BackupsCard />` and `<RestoreCard />` immediately AFTER `<SystemCard />`; this lane inserts `<HealthCard />` and `<ActivityCard />` immediately BEFORE `id="app-settings"`. Adjacent lines — expect a conflict; final order System → Backups → Restore → Health → Activity → App settings. Merge the two `vi.mock('../api/lifecycle', …)` blocks into ONE with the union of names (`fetchSnapshots, createSnapshot, restoreUpload, restoreStored, fetchActivity, fetchActivityRun, undoBatch, fetchHealth`) and both `beforeEach` mock values.
- `src/components/settings/settings.css`: both lanes append blocks — keep both.
- `src/components/paletteRegistry.ts`: F1 owns all four sections; this lane does not touch it.
- `src/App.tsx`: only this lane touches it (`SessionPrefs`, `LandingRedirect`). `src/pages/LoginPage.tsx`: one added line. `src/pages/MonthlyUpdatePage.tsx`: only this lane — but shell Plan 3 migrates the wizard to `PageFrame`/`ScopeBar` in the same window; the edits here are inside `save()`/`deleteMonth()` and should rebase cleanly.
- `src/api/client.ts`, `src/types/api.ts`: untouched (Phase 0 owns them).
- Browser smoke for Phase 2: toggle the theme in one profile, sign in from a second → it paints dark then flips within the first fetch; save a month → toast with Undo → Undo → the month reverts and Activity shows "Undid: …"; on a seeded zero-filled month, Data health → Delete Sep 2026 → Delete Sep 2026? → toast → the check clears; Undo brings it back.

## Self-review

**Spec coverage:** §10 reconciliation rules 1–6 (local-first paint via the same keys; `GET /prefs` once per session under `shell:prefs` after `/auth/me`; seed-up when the server is empty; server wins unless the key is dirty this session; debounced 400 ms per key; failed PATCH retried on the next change or session, never surfaced; last-writer-wins by `updated_at` is the server's job; logout keeps local) → Tasks 1–3; `ThemeProvider`, `useScope` and the palette read through the store → Task 2; `App.tsx` redirects `/` to `landing_page` once per tab session → Task 3; Appearance card gains Landing page and "Synced to your account" → Task 4. §9 UI — `X-Change-Batch` read by the two DELETE fetchers, `batch_id` from the PUT bodies, wizard save/delete toasts with Undo firing spending then balances then returning to the month, the Activity card (last 50, relative time, label, source pill, arm-on-click Undo, View report, Load more, refusals verbatim) → Tasks 5–6. §11 UI — Data health card lists non-ok checks with their fix; the repair arms, runs as `source='repair'`, toasts with Undo, refetches; `snapshot_now` → Task 7. §13 vitest: ActivityCard undo and report view; wizard toasts carry Undo and call both undos in order; prefsStore local-first, seed-up, server-wins, dirty-key, debounce, silent failure; landing redirect; HealthCard repair → Tasks 1, 3, 5–7. **Placeholders:** none — the two "the file's render helper" notes name existing code. **Type consistency:** `getLocal/setLocal/subscribe/syncFromServer/isSynced/subscribeSynced/resetPrefsStoreForTests`, `STORAGE_KEYS`, `PREFS_SNAPSHOT`, `PATCH_DEBOUNCE_MS`, `ScopeMemory`, `landingTarget/clearLanded/LANDED_KEY`, `deleteMonthBalances -> { batchId }`, `deleteSpendingMonth(month, { source? }) -> { batchId }`, `undoBatches(ids, done, after)`; Phase 0's `apiWithHeaders`, `fetchPrefs/patchPrefs`, `fetchActivity(before?)`, `fetchActivityRun`, `undoBatch`, `fetchHealth`, `createSnapshot`, `ActivityBatch/Run/Page/RunDetail`, `HealthCheck/HealthOut`, `RestoreReport`, `RestoreReportView({ report })` — used as defined in `2026-09-04-lifecycle-0-base.md`; the header name `X-Change-Source: repair` and the `delete_spending_month`/`snapshot_now` action ids match L2 and L3.
