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
// is never surfaced — the keys still owed to the server are themselves persisted, so a reload
// between the failure and the retry does not turn into a silent revert. The storage keys keep
// their old spellings so nothing is lost on deploy; `endSession` drops the sync state (never
// the values) when the account goes away.

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
// The bookkeeping key, beside the value keys but deliberately NOT one of them: PREF_KEYS is
// STORAGE_KEYS' own key list, so an entry there would become a sixth preference the sync
// tries to GET, adopt and PATCH. One key holds the whole set (see `dirty` below).
export const DIRTY_STORAGE_KEY = 'finance.prefsDirty'
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
// TWO sets, because they answer two different questions:
//  • `changed` — did the user move this key since the tab opened? That is what makes the
//    browser win over a GET that was already in flight, so a PATCH landing first must NOT
//    forget it: the answer to that GET still carries the pre-change value.
//  • `dirty` — is the SERVER's copy of this key still behind the browser's? Persisted under
//    DIRTY_STORAGE_KEY, because in memory alone a failed PATCH followed by a reload would let
//    the next session ADOPT the server's stale value and silently revert what the user picked,
//    while spec §10 rule 4 promises a retry "on the next change or session".
const changed = new Set<PrefKey>()
const dirty = new Set<PrefKey>()
const pending = new Map<PrefKey, unknown>() // server values awaiting a PATCH (debounced or failed)
const timers = new Map<PrefKey, ReturnType<typeof setTimeout>>()
const listeners = new Map<PrefKey, Set<(value: never) => void>>()
const syncedListeners = new Set<(synced: boolean) => void>()

function readDirty(): PrefKey[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(DIRTY_STORAGE_KEY)
  } catch {
    return []
  }
  const parsed = parseJson(raw)
  if (!Array.isArray(parsed)) return []
  // Filtered against the registry: a key some future build stops knowing would otherwise sit
  // in the set for the life of the browser, asking for a seed nothing can read.
  return parsed.filter((key): key is PrefKey => PREF_KEYS.includes(key as PrefKey))
}

function writeDirty(): void {
  try {
    if (dirty.size === 0) localStorage.removeItem(DIRTY_STORAGE_KEY)
    else localStorage.setItem(DIRTY_STORAGE_KEY, JSON.stringify([...dirty]))
  } catch {
    // A blocked localStorage costs the retry-after-reload, never the preference itself.
  }
}

/** The server now holds these keys' values, so they are no longer behind — unless a NEWER
 *  change is already queued behind the PATCH that just landed (`pending` still has it). */
function confirmSent(keys: PrefKey[]): void {
  let cleared = false
  for (const key of keys) {
    if (pending.has(key)) continue
    cleared = dirty.delete(key) || cleared
  }
  if (cleared) writeDirty()
}

// Store init: last session's unconfirmed keys come back, so the next sync seeds them up
// instead of adopting over them.
readDirty().forEach((key) => dirty.add(key))

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
  changed.add(key)
  if (!dirty.has(key)) {
    dirty.add(key)
    writeDirty()
  }
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
  const sentKeys = Object.keys(body) as PrefKey[]
  if (sentKeys.length === 0) return
  for (const sent of sentKeys) pending.delete(sent)
  try {
    await patchPrefs(body)
    confirmSent(sentKeys)
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
    if (server === undefined || changed.has(key) || dirty.has(key)) {
      // The server has nothing, the user moved this key before the answer landed, or an
      // earlier PATCH never got through (`dirty` survived a reload): the browser seeds the
      // account. Adopting here is what would revert the user's own choice.
      if (local !== undefined) seed[key] = (codecs[key].toServer as (v: unknown) => unknown)(local)
      continue
    }
    const value = codecs[key].fromServer(server.value)
    if (value !== undefined) (adopt as (k: PrefKey, v: unknown) => void)(key, value)
  }
  for (const [key, value] of pending) seed[key] = value // earlier failed PATCHes ride along
  pending.clear()
  // The GET has landed, so there is no in-flight answer left to lose a race against; from
  // here on `dirty` alone tracks what the server is still missing.
  changed.clear()
  synced = true
  syncedListeners.forEach((listener) => listener(true))
  const seeded = Object.keys(seed) as PrefKey[]
  if (seeded.length > 0) {
    try {
      await patchPrefs(seed)
      confirmSent(seeded)
    } catch {
      for (const [key, value] of Object.entries(seed)) pending.set(key as PrefKey, value)
    }
  }
}

/** The session ended in this tab (sign-out, or an identity that stopped answering). Every
 *  piece of sync state belongs to the account that just left: its dirty keys would seed the
 *  NEXT account's server from this one's choices, a pending PATCH would post them under the
 *  next token, and `synced` would have Appearance claim "Synced to your account." before any
 *  GET. The VALUES stay — they are this browser's paint, and the next sign-in reconciles
 *  them. Key subscriptions stay too: they belong to mounted components, not to the session. */
export function endSession(): void {
  synced = false
  changed.clear()
  dirty.clear()
  writeDirty()
  pending.clear()
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  syncedListeners.forEach((listener) => listener(false))
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
  changed.clear()
  pending.clear()
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  listeners.clear()
  syncedListeners.clear()
  // A fresh module load, storage included — `dirty` is re-read exactly as it is at init, so a
  // test simulates a reload by calling this WITHOUT clearing localStorage.
  dirty.clear()
  readDirty().forEach((key) => dirty.add(key))
}
