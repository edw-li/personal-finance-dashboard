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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isPersonId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isRange = (v: unknown): v is RangePreset => v === 'all' || v === '1y' || v === 'ytd'
const isTheme = (v: unknown): v is ThemeChoice => v === 'system' || v === 'dark' || v === 'light'
const isDensity = (v: unknown): v is Density => v === 'comfortable' || v === 'compact'
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

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
        value.owner === 'all'
          ? null
          : value.owner === 'joint'
            ? 'joint'
            : isPersonId(value.owner)
              ? value.owner
              : undefined
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
      void flushKey(key)
    }, PATCH_DEBOUNCE_MS),
  )
}

/** One key's debounce elapsed: PATCH that key, and let any key whose own PATCH failed earlier
 *  (so it has no timer of its own left) ride along instead of waiting for a session. Failures
 *  re-queue silently (spec §10 rule 4) — the next change, or the next sync, carries them. */
async function flushKey(key: PrefKey): Promise<void> {
  if (getToken() === null) return // no session: the value stays local and stays pending
  const body: Record<string, unknown> = {}
  for (const [candidate, value] of pending) {
    if (candidate === key || !timers.has(candidate)) body[candidate] = value
  }
  if (Object.keys(body).length === 0) return
  for (const sent of Object.keys(body)) pending.delete(sent as PrefKey)
  try {
    await patchPrefs(body)
  } catch {
    for (const [sent, value] of Object.entries(body)) {
      if (!pending.has(sent as PrefKey)) pending.set(sent as PrefKey, value)
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

export function subscribe<K extends PrefKey>(
  key: K,
  listener: (value: PrefValues[K]) => void,
): () => void {
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
