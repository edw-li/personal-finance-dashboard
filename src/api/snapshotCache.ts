// Page-snapshot cache (2026-08-27 spec §1): in-memory, per-tab, token-scoped by the
// wipes below — a reload starts clean on purpose. Pages seed their useState
// initializers from here and revalidate on mount; api() wipes the whole map after any
// non-GET (coarse and always-correct), and the 401 path + logout wipe it because a
// snapshot is session data.
//
// Values are stored by reference and treated as immutable: pages must never mutate a
// payload they read back (they don't — every load replaces whole objects).
const cache = new Map<string, unknown>()

export function getSnapshot<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined
}

export function setSnapshot(key: string, value: unknown): void {
  cache.set(key, value)
}

export function clearSnapshots(): void {
  cache.clear()
}
