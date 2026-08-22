// Clipboard classification for range paste (spec 2026-08-21 §4.1). Pure text-in,
// structure-out: the PAGES decide what to fill — parents own the entry state, so
// AmountInput never touches a sibling.

export interface PositionalPaste {
  mode: 'positional'
  values: string[]
}

export interface KeyedPaste {
  mode: 'keyed'
  rows: { label: string; value: string }[]
  /** One-cell rows found inside a keyed block — reported, never guessed at. */
  skipped: number
}

/**
 * Split clipboard text into a paste plan, or null when it is a single cell (native
 * insertion + tolerant parsing already handle that). Rows on newlines, cells on tabs —
 * the two characters parseAmount deliberately REFUSES as grouping, so a multi-cell
 * clipboard can never masquerade as one number (the amount.ts pin's counterpart).
 *
 * Shapes: N×1 → positional column. 1×N → positional TRANSPOSED (the source sheet stores
 * months as rows, so a copied month arrives horizontal). ≥2 rows with any 2-cell row →
 * keyed: first cell is the label, LAST cell the value (covers both name→value and
 * name→…→latest-month ranges).
 */
export function classifyPaste(text: string): PositionalPaste | KeyedPaste | null {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.split('\t').map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''))
  if (rows.length === 0) return null
  if (rows.length === 1) {
    const cells = rows[0].filter((cell) => cell !== '')
    return cells.length <= 1 ? null : { mode: 'positional', values: cells }
  }
  if (rows.every((cells) => cells.length === 1)) {
    return { mode: 'positional', values: rows.map((cells) => cells[0]) }
  }
  const keyed = rows.filter((cells) => cells.length >= 2)
  return {
    mode: 'keyed',
    rows: keyed.map((cells) => ({ label: cells[0], value: cells[cells.length - 1] })),
    skipped: rows.length - keyed.length,
  }
}

/** Lowercase and strip every non-alphanumeric — "Food &  Dining" ≡ "food dining". */
function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a pasted label to a row id: trimmed case-insensitive exact first, then
 * slug-normalized equality. A miss is a report, never a guess — filling the wrong
 * account with the right number is worse than filling nothing.
 */
export function matchLabel(labels: { id: number; name: string }[], pasted: string): number | null {
  const needle = pasted.trim().toLowerCase()
  for (const { id, name } of labels) {
    if (name.trim().toLowerCase() === needle) return id
  }
  const slug = slugOf(pasted)
  if (slug === '') return null
  for (const { id, name } of labels) {
    if (slugOf(name) === slug) return id
  }
  return null
}
