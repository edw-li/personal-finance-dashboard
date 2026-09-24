// Unsaved work per PART (2026-09-23 spec §M6). The wizard's drafts close two losses — any navigation
// away mid-entry (a plain <BrowserRouter> has no route guard) and the mid-save 401 — and now that a
// month's balances and its spending are saved apart they are drafted apart too: restoring or
// discarding one never drags the other with it. sessionStorage, as before: a draft is "this sitting",
// and a week-old one resurrecting over fresh server data would be worse than the loss it prevents.

export type DraftPart = 'balances' | 'flows'

export interface BalancesDraft {
  balances?: Record<string, string>
  notes?: string
  /** Optional so a draft written before this field still parses (2026-09-04 review). */
  typedParents?: number[]
}

export interface FlowsDraft {
  amounts?: Record<string, string>
  netPay?: string
}

const PREFIX = 'finance-update-draft:'

export const draftKey = (part: DraftPart, month: string) => `${PREFIX}${part}:${month}`

/** The whole-month key every draft used before the parts were split. */
const legacyKey = (month: string) => `${PREFIX}${month}`

function parse(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** A part's draft, or null. A shape check, not a validator: a corrupt entry is dropped, never restored. */
export function readDraft<T extends BalancesDraft | FlowsDraft>(part: DraftPart, month: string): T | null {
  const key = draftKey(part, month)
  const raw = sessionStorage.getItem(key)
  const value = parse(raw)
  if (raw !== null && value === null) sessionStorage.removeItem(key)
  return value as T | null
}

export function writeDraft(part: DraftPart, month: string, value: BalancesDraft | FlowsDraft): void {
  sessionStorage.setItem(draftKey(part, month), JSON.stringify(value))
}

export function removeDraft(part: DraftPart, month: string): void {
  sessionStorage.removeItem(draftKey(part, month))
}

/** A draft written before the split (`finance-update-draft:<month>`) becomes the two part drafts on
 *  first read — its `recordedOn` dropped, since the server stamps that date now (spec §M4) — and the
 *  legacy key goes. A part that already has its own draft keeps it: that one is newer. */
export function splitLegacyDraft(month: string): void {
  const raw = sessionStorage.getItem(legacyKey(month))
  if (raw === null) return
  sessionStorage.removeItem(legacyKey(month))
  const legacy = parse(raw)
  if (legacy === null) return
  const pick = (fields: string[]) =>
    Object.fromEntries(fields.filter((field) => field in legacy).map((field) => [field, legacy[field]]))
  const balances = pick(['balances', 'notes', 'typedParents'])
  const flows = pick(['amounts', 'netPay'])
  if (Object.keys(balances).length > 0 && sessionStorage.getItem(draftKey('balances', month)) === null) {
    writeDraft('balances', month, balances as BalancesDraft)
  }
  if (Object.keys(flows).length > 0 && sessionStorage.getItem(draftKey('flows', month)) === null) {
    writeDraft('flows', month, flows as FlowsDraft)
  }
}
