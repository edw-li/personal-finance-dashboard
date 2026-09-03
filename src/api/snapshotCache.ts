// Page-snapshot cache (2026-08-27 spec §1): in-memory, per-tab, token-scoped by the
// wipes below — a reload starts clean on purpose. Pages seed their useState
// initializers from here and revalidate on mount; api() drops the FAMILIES a non-GET can
// have moved (client.ts's MUTATION_FAMILIES — an unmapped path still wipes the whole map),
// and the 401 path + logout wipe it because a snapshot is session data.
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

/** Drop every key the predicate accepts (family invalidation, 2026-09-03 shell spec §13):
 *  api() uses it to spare the pages a mutation cannot have moved. The keys are copied out
 *  first so the predicate runs against a stable list while entries are being deleted. */
export function clearSnapshotsWhere(predicate: (key: string) => boolean): void {
  for (const key of [...cache.keys()]) if (predicate(key)) cache.delete(key)
}
