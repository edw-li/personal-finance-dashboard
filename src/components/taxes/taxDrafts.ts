import { FILING_STATUSES } from '../../api/taxes'
import type { FilingStatus } from '../../types/api'

// ── Unsaved tax edits survive (2026-09-23 spec §W9) ─────────────────────────────────────────
// The Taxes page's two editors lost typed work on any navigation, reload or 401 redirect. Each
// now mirrors its unsaved work into sessionStorage continuously (the update wizard's draft
// posture: "this sitting", never a week-old draft resurrecting over fresh data), and a draft
// carries the values that were LOADED when editing began beside the values typed over them. A
// mount restores it only while the server still returns those loaded values: once another
// device has saved, or an Apply has written, a restore would silently revert that change on the
// next Save — so such a draft is dropped, with a note saying so.

/** One form's unsaved work and the server values it was typed over. */
export interface TaxDraft<T> {
  loaded: T
  edited: T
}

const INPUTS_PREFIX = 'finance-tax-inputs-draft:'
const BRACKETS_PREFIX = 'finance-tax-brackets-draft:'

export function inputsDraftKey(year: number): string {
  return `${INPUTS_PREFIX}${year}`
}

export function bracketsDraftKey(year: number, status: FilingStatus): string {
  return `${BRACKETS_PREFIX}${year}:${status}`
}

/** A record of box texts keyed by cell id — the inputs form's `values`. */
export function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

/** Key-sorted JSON, so two records with the same content compare equal in any order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : entry,
  )
}

/** Same content, whatever the key order. */
export function sameRecord(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

/** The draft under `key`, or null — a corrupt or misshapen entry is no draft, never a throw. */
export function readTaxDraft<T>(
  key: string,
  isValue: (value: unknown) => value is T,
): TaxDraft<T> | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { loaded, edited } = parsed as Partial<TaxDraft<unknown>>
    return isValue(loaded) && isValue(edited) ? { loaded, edited } : null
  } catch {
    return null
  }
}

export function writeTaxDraft<T>(key: string, draft: TaxDraft<T>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Storage full or blocked: losing the safety net is acceptable (the wizard's posture).
  }
}

export function clearTaxDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Blocked storage has nothing to clear.
  }
}

/** Every draft of one year — its inputs and each status' tables. An accepted "Discard unsaved
 *  changes for {year}?" and a deleted year both mean all of them. */
export function clearYearDrafts(year: number): void {
  clearTaxDraft(inputsDraftKey(year))
  for (const status of FILING_STATUSES) clearTaxDraft(bracketsDraftKey(year, status))
}

export type DraftResume<T> =
  | { kind: 'none' }
  | { kind: 'restored'; edited: T }
  | { kind: 'dropped' }

/**
 * What a mount (or a tab load) does with the draft under `key`, given what the server returns
 * now. A pure READ: the editor's continuous write is what then clears a draft that is not put
 * back on screen, because the boxes it mounts with match the server.
 *
 * - no draft, or one whose edits equal its own loaded values: nothing to say;
 * - loaded values that no longer equal the server's: dropped, and the caller says so;
 * - otherwise: restored.
 */
export function resumeDraft<T>(
  key: string,
  current: T,
  isValue: (value: unknown) => value is T,
  same: (a: T, b: T) => boolean,
): DraftResume<T> {
  const draft = readTaxDraft(key, isValue)
  if (draft === null || same(draft.edited, draft.loaded)) return { kind: 'none' }
  if (!same(draft.loaded, current)) return { kind: 'dropped' }
  return { kind: 'restored', edited: draft.edited }
}
