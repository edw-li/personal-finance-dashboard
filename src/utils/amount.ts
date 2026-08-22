// Tolerant ENTRY-side parsing (spec 2026-08-21 §3.1) — the counterpart of format.ts's
// display-only rule: everything here produces the plain decimal strings the API stores,
// and nothing formatted ever leaves this module toward the wire.

// The same shape percent.ts pins: optional sign, digits with an optional point, at least
// one digit somewhere. Exponent notation deliberately does NOT match — Python's Decimal
// would accept "1e5" and silently store 100000 (isPlainDecimal's documented hole).
const PLAIN_AMOUNT = /^([+-]?)(\d*)(?:\.(\d*))?$/

export interface ParsedAmount {
  canonical: string
}

/**
 * Parse one typed/pasted amount into its canonical plain-decimal string.
 *
 * Accepts: leading +/-, "$", comma grouping (positions not validated), surrounding and
 * interior spaces, accounting parentheses "(1,234.56)". Rejects exponents, multiple
 * points, signs inside parentheses, and anything else.
 *
 * IDEMPOTENCE GUARANTEE: input already in plain form returns VERBATIM ("0.00" never
 * becomes "0"), so canonicalizing a server seed is a no-op — the wizard draft machinery
 * and the tax form's changed-key diff both count on a focus+blur of an untouched field
 * producing zero difference.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const already = PLAIN_AMOUNT.exec(trimmed)
  if (already !== null && `${already[2]}${already[3] ?? ''}` !== '') {
    return { canonical: trimmed }
  }

  let text = trimmed
  let negative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1).trim()
    // "(-5)" is a contradiction or a double negative — refuse rather than guess.
    if (text.startsWith('+') || text.startsWith('-')) return null
  } else if (text.startsWith('+') || text.startsWith('-')) {
    negative = text.startsWith('-')
    text = text.slice(1).trim()
  }
  if (text.startsWith('$')) text = text.slice(1)
  text = text.replaceAll(',', '').replaceAll(' ', '')
  const match = PLAIN_AMOUNT.exec(text)
  // A surviving sign here ("$-500") means the sign sat in an unconventional spot; the
  // conventional forms ("-$500", "($500)") were consumed above.
  if (match === null || match[1] !== '' || `${match[2]}${match[3] ?? ''}` === '') return null
  return { canonical: `${negative ? '-' : ''}${text}` }
}

/**
 * The wire-boundary belt: canonical form when parseable, trimmed original otherwise
 * (existing validators still catch the garbage and word the error). EVERY payload builder
 * goes through this — blur usually canonicalized already, but a submit reached without a
 * blur (Ctrl+Enter, jsdom clicks) must not ship "$1,600" to a Decimal column.
 */
export function canonicalAmount(raw: string): string {
  return parseAmount(raw)?.canonical ?? raw.trim()
}
