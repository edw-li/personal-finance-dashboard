// Tolerant ENTRY-side parsing (spec 2026-08-21 §3.1) — the counterpart of format.ts's
// display-only rule: everything here produces the plain decimal strings the API stores,
// and nothing formatted ever leaves this module toward the wire.

// The same shape percent.ts pins: optional sign, digits with an optional point. The regex
// ALONE is looser than that reads — '', '+' and '.' all match it — so the "at least one
// digit somewhere" rule lives at the exec sites, which check the captured digits directly.
// Exponent notation deliberately does NOT match — Python's Decimal would accept "1e5" and
// silently store 100000 (isPlainDecimal's documented hole).
const PLAIN_AMOUNT = /^([+-]?)(\d*)(?:\.(\d*))?$/

// The grouping separators stripped before parsing: plain space, comma, and the NBSP /
// narrow NBSP that Excel, Sheets and several locales paste as thousands separators.
// The class is deliberately EXPLICIT rather than \s: \s would also swallow tab and
// newline, and a multi-cell clipboard ("1500<TAB>200") would then silently merge into one
// wrong number instead of being refused.
const GROUPING = /[ ,\u00A0\u202F]/g

export interface ParsedAmount {
  canonical: string
}

/**
 * Parse one typed/pasted amount into its canonical plain-decimal string.
 *
 * Accepts: leading +/-, "$", comma grouping (positions not validated), surrounding and
 * interior spaces (incl. NBSP/narrow no-break space), accounting parentheses
 * "(1,234.56)". Rejects exponents, multiple points, signs inside parentheses, and
 * anything else.
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
  // At least one digit somewhere: "." and "" match the pattern but convert to nothing.
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
  text = text.replace(GROUPING, '')
  const match = PLAIN_AMOUNT.exec(text)
  // A surviving sign here ("$-500") means the sign sat in an unconventional spot; the
  // conventional forms ("-$500", "($500)") were consumed above.
  if (match === null || match[1] !== '' || `${match[2]}${match[3] ?? ''}` === '') return null
  return { canonical: `${negative ? '-' : ''}${text}` }
}

interface AmountOptions {
  /**
   * Whether a leading "=" is an evaluable expression. MONEY BOXES ONLY (spec §3.2):
   * the evaluator quantizes to 2dp, so letting "=1/8" through a 6dp shares or
   * split-factor path would commit 0.13 where 0.125 was meant — a silent wrong
   * number. Non-money callers pass { expressions: false } and "=…" stays verbatim
   * (invalid), for the existing validators to word.
   */
  expressions?: boolean
}

/**
 * The wire-boundary belt: canonical form when parseable, trimmed original otherwise
 * (existing validators still catch the garbage and word the error), with "="-entries
 * evaluated only where expressions are opted in. EVERY payload builder goes through this —
 * blur usually canonicalized already, but a submit reached without a blur (Ctrl+Enter,
 * jsdom clicks) must not ship "$1,600" to a Decimal column.
 *
 * Extended for "="-entries: an expression canonicalizes to its evaluated 2dp result, so a
 * submit that never saw a blur ships 1234.56 rather than the literal text "=1200+34.56".
 */
export function canonicalAmount(raw: string, { expressions = true }: AmountOptions = {}): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('=')) return expressions ? (evaluateAmount(trimmed) ?? trimmed) : trimmed
  return parseAmount(trimmed)?.canonical ?? trimmed
}

/**
 * Round a plain decimal string to `places` decimals (>= 1) exactly the way the server will —
 * Decimal.quantize(..., ROUND_HALF_UP), ties away from zero. Lifted VERBATIM from
 * BracketsEditor (whose validate() must keep agreeing with the API's post-quantize
 * comparisons); non-plain text is handed back untouched. `places` >= 1 is a precondition —
 * with places 0 the output carries a trailing dot; every caller passes 2 or 4.
 */
export function quantize(raw: string, places: number): string {
  const text = raw.trim()
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match) return text
  const [, sign, whole, frac = ''] = match
  if (`${whole}${frac}` === '') return text
  const kept = `${whole === '' ? '0' : whole}${frac.slice(0, places).padEnd(places, '0')}`
  // HALF_UP reads exactly one dropped digit: 5..9 rounds the magnitude away from zero.
  const digits = frac.charAt(places) >= '5' ? addOne(kept) : kept
  const point = digits.length - places
  return `${sign}${digits.slice(0, point).replace(/^0+(?=\d)/, '')}.${digits.slice(point)}`
}

/** +1 on a digit string, carrying left and growing by one digit on an all-nines carry. */
function addOne(digits: string): string {
  const out = [...digits]
  let i = out.length - 1
  while (i >= 0 && out[i] === '9') {
    out[i] = '0'
    i -= 1
  }
  if (i < 0) return `1${out.join('')}`
  out[i] = String(Number(out[i]) + 1)
  return out.join('')
}

// Money magnitude fence for expression results — far above the server's own column
// bounds, far below where Number.toFixed loses the plot.
const EXPRESSION_MAX = 1e12

// Pathological unary chains ("=+++…+5") recurse once per sign; a legitimate receipt
// formula never approaches this length, so fence the INPUT instead of counting depth.
const EXPRESSION_MAX_LENGTH = 200

/**
 * Evaluate a leading-"=" arithmetic entry ("=1200+34.56") to a 2dp HALF_UP plain decimal
 * string, or null when the text is not a well-formed expression, when the result is
 * non-finite, or when it exceeds the magnitude fence. Float math is fine here
 * (receipt-scale sums); the RESULT is quantized through the same HALF_UP the server uses.
 * Grammar: expr = term (('+'|'-') term)*; term = factor (('*'|'/') factor)*;
 * factor = number | '(' expr ')' | ('+'|'-') factor. Plain decimal literals only —
 * no commas, no '$', no exponents inside an expression.
 */
export function evaluateAmount(raw: string): string | null {
  const text = raw.trim()
  if (!text.startsWith('=')) return null
  if (text.length > EXPRESSION_MAX_LENGTH) return null
  const result = evalExpression(text.slice(1))
  if (result === null || !Number.isFinite(result) || Math.abs(result) >= EXPRESSION_MAX) {
    return null
  }
  // toFixed(6) never produces exponent notation below the fence; quantize does the
  // HALF_UP at 2dp so the rounding rule stays the server's.
  return quantize(result.toFixed(6), 2)
}

function evalExpression(source: string): number | null {
  let pos = 0
  const skip = () => {
    while (source[pos] === ' ') pos += 1
  }
  function factor(): number | null {
    skip()
    const ch = source[pos]
    if (ch === '(') {
      pos += 1
      const inner = expr()
      if (inner === null) return null
      skip()
      if (source[pos] !== ')') return null
      pos += 1
      return inner
    }
    if (ch === '+' || ch === '-') {
      pos += 1
      const inner = factor()
      return inner === null ? null : ch === '-' ? -inner : inner
    }
    const start = pos
    while (pos < source.length && /[\d.]/.test(source[pos])) pos += 1
    const text = source.slice(start, pos)
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return null
    return Number(text)
  }
  function term(): number | null {
    let left = factor()
    if (left === null) return null
    for (;;) {
      skip()
      const op = source[pos]
      if (op !== '*' && op !== '/') return left
      pos += 1
      const right = factor()
      if (right === null) return null
      left = op === '*' ? left * right : left / right
    }
  }
  function expr(): number | null {
    let left = term()
    if (left === null) return null
    for (;;) {
      skip()
      const op = source[pos]
      if (op !== '+' && op !== '-') return left
      pos += 1
      const right = term()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
  }
  const result = expr()
  skip()
  return pos === source.length ? result : null
}

/** One committable-entry test for validity gating: tolerant amount OR (money) expression. */
export function isAmount(raw: string, { expressions = true }: AmountOptions = {}): boolean {
  if (raw.trim().startsWith('=')) return expressions && evaluateAmount(raw) !== null
  return parseAmount(raw) !== null
}
