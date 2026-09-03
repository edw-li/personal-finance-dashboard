import { api } from './client'
import type { PrefsOut } from '../types/api'

// Server-side preferences (2026-09-03 data-lifecycle spec §10). No trailing slash: the
// router mounts GET/PATCH on the bare prefix (the /settings precedent — "/prefs/" costs a
// 307). The store in src/prefs/prefsStore.ts is the only caller; components read the store.
export function fetchPrefs(): Promise<PrefsOut> {
  return api<PrefsOut>('/prefs')
}

// PARTIAL by design: only the keys sent are upserted; the response is the full set.
export function patchPrefs(partial: Record<string, unknown>): Promise<PrefsOut> {
  return api<PrefsOut>('/prefs', { method: 'PATCH', body: JSON.stringify(partial) })
}

// Resets one key to its default (deletes the row).
export function deletePref(key: string): Promise<void> {
  return api<void>(`/prefs/${key}`, { method: 'DELETE' })
}
