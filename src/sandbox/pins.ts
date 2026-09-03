// Pinned scenarios (2026-09-03 planning-sandboxes spec §4, §8.5): personal working memory in
// localStorage, KNOBS ONLY — an array of the URL's entry strings, never a result — so a
// pinned column is always re-run against live data and can never show a stale number. At
// most three per page. Storage is user-writable, so every read is validated: the shape
// here, the entries by the page's own decoder (`accept`). `finance.sandbox.*` migrates with
// `finance.scope` when the Data lifecycle spec's preferences endpoint lands.

export type SandboxPage = 'paycheck' | 'taxes' | 'projection'

export const PIN_LIMIT = 3
export const PINS_VERSION = 1

export interface Pin {
  id: string
  label: string
  createdAt: string
  entries: string[]
}

export function pinsKey(page: SandboxPage): string {
  return `finance.sandbox.${page}`
}

function isPin(value: unknown): value is Pin {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string' &&
    Array.isArray(record.entries) &&
    record.entries.every((entry) => typeof entry === 'string')
  )
}

/** Every stored pin whose shape is right AND whose entries the page's decoder accepts.
 *  A corrupt blob, a foreign version or a non-object reads as empty. */
export function readPins(page: SandboxPage, accept: (entries: string[]) => boolean): Pin[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pinsKey(page)) ?? 'null')
    if (parsed === null || typeof parsed !== 'object') return []
    const blob = parsed as { version?: unknown; pins?: unknown }
    if (blob.version !== PINS_VERSION || !Array.isArray(blob.pins)) return []
    return blob.pins
      .filter(isPin)
      .filter((pin) => accept(pin.entries))
      .slice(0, PIN_LIMIT)
  } catch {
    return []
  }
}

export function writePins(page: SandboxPage, pins: Pin[]): void {
  try {
    localStorage.setItem(pinsKey(page), JSON.stringify({ version: PINS_VERSION, pins }))
  } catch {
    // Storage full or disabled: the pin still lives in this tab's state; nothing on screen lies.
  }
}

export function newPin(label: string, entries: string[]): Pin {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    createdAt: new Date().toISOString(),
    entries: [...entries],
  }
}
