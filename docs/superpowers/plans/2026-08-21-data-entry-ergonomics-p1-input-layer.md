# Data-Entry Ergonomics Phase 1 — Input Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared input layer from spec `docs/superpowers/specs/2026-08-21-data-entry-ergonomics-design.md` §3 — tolerant `parseAmount`, `=`-arithmetic, the `<AmountInput>` component (type-to-replace, Escape-revert, formatted echo), the `data-entry-scope` keyboard protocol, and adoption across the wizard, taxes, portfolio, comp, ESPP, and paycheck surfaces.

**Architecture:** One new util module (`src/utils/amount.ts`) supplies parsing/evaluation/quantization; one new component (`src/components/AmountInput.tsx`) wraps every money/decimal box and owns focus/keyboard behavior via DOM-scoped `data-entry-scope`/`data-entry-cell`/`data-entry-primary` attributes (no ref plumbing). Adoption is mechanical per surface; every wire payload passes through `canonicalAmount()` so the API always receives plain decimals regardless of blur timing.

**Tech Stack:** React 19 + TS, vitest + @testing-library/react (`fireEvent` only — **no user-event package**), plain CSS. Frontend-only: zero backend/API/migration changes in this phase.

**Branch:** `feature/data-entry-ergonomics-p1` off `main`.

**Execution conventions (repo precedent, RSU overnight build):** implementer subagents run on Opus; each task gets a spec-compliance review + code-quality review before the next task starts; final whole-branch review before ff-merge to main. Gates per task: targeted `npx vitest run <file>`; final task runs full `npm run test`, `npm run lint` (exactly 1 sanctioned AuthContext warning), `npx tsc -b`, `npm run build` (EChart chunk must stay byte-identical at 700.93 kB — this phase never touches charts).

---

## Locked design decisions (from spec §3 + session review — implementers do not relitigate)

1. **Idempotence guarantee:** `parseAmount` returns an already-plain-decimal input **verbatim** (never `0.00` → `0`), so blurring an untouched server-seeded field produces zero state change — the wizard's draft machinery and the tax form's diff counting depend on this.
2. **Display echo:** while **focused**, an `AmountInput` shows the raw state; while **blurred** and parseable it shows a formatted echo (`$1,500.00` / share count / `13%`). State and wire never contain formatted text.
3. **`canonicalAmount()` at every wire boundary.** jsdom's `fireEvent.click` does not blur, and a real Ctrl+Enter clicks Save without a blur either — so payload builders must canonicalize, not trust blur. This is also what existing wire-body test assertions prove.
4. **Enter semantics:** inside a `[data-entry-scope]` container, Enter/ArrowDown advance (Shift+Enter/ArrowUp go back), last-cell Enter focuses the scope's `[data-entry-primary]`, Ctrl+Enter (and Ctrl+S, preventDefault'd) clicks it. Outside a scope, AmountInput leaves Enter alone (native implicit form submission = commit-the-row in ledger forms). **Documented behavior change:** plain Enter in the tax inputs form advances instead of saving all 43; Ctrl+Enter saves.
5. **Integer boxes stay plain `<input>`** (pay periods, RSU shares, focal year, vest quantum, the `type="number"` new-tax-year box): spec §3.1 keeps their integer regexes; they are not AmountInputs in this phase.
6. **Out of scope for the sweep** (deliberate, revisit later): ProjectionPage knobs, WhatIfPanel legs, SettingsPage app-settings, LoginPage. Date inputs and `<select>`s are never AmountInputs.
7. **Test display rule:** a focused cell asserts raw text, a blurred cell asserts the formatted echo. The **first cell of each wizard step autofocuses**, so in the wizard fixture (`Checking` is the only account) `Checking` shows raw on load while `Food` (spending step, netPay autofocuses) shows `$0.00`.
8. Text-y fields adopted onto `.field-input` (account, notes, ticker…) inherit its right-aligned monospace look — the comp/paycheck notes boxes already do this today; no new alignment CSS in this phase.

> **Amendment (post-Task-2 quality review, controller-decided):** `=`-arithmetic is MONEY-ONLY end to end, enforcing spec §3.2's letter. `isAmount(raw, { expressions = true })` and `canonicalAmount(raw, { expressions = true })` gain an opt; `AmountInput` passes `expressions: kind === 'money'`; Tasks 7-8's NON-money payload belts (shares, split_factor, RSU counts, percent fields) call the helpers with `{ expressions: false }` so a no-blur `=1/8` can never commit a 2dp-quantized `0.13` into a 6dp shares/factor column. Also folded into Task 3: an input-length fence in `evaluateAmount` (pathological `=+++…` unary chains previously threw RangeError), six evaluator precedence/associativity/negative-result pins, and two JSDoc completions (quantize `places >= 1`; evaluateAmount's non-finite/fence null clause).

> **Amendment 2 (post-Task-7/8 reviews, controller-decided — THE KIND-SCALE RULE, supersedes this plan's per-field kind assignments where they conflict):** `kind="money"` is for genuinely 2dp columns ONLY. Any >2dp column gets `kind="plain"` (verbatim display — a `$…`-2dp echo over a 4dp/5dp value lies) **paired with** `{ expressions: false }` on every gate/belt for that field (the 2dp evaluator must never coarsen a finer column; belt and box must agree — a money-kind box evaluates `=` on blur, so a belt-only opt-out is no guard, proven live in commits 9d04c6a/f5dd8c2). Shipped mapping: SecuritiesPanel manual price + annual_dividend (14,4), comp unvested_price/grant_price + RsuGrant grant_price (14,4), ESPP lot subscription/FMV/purchase/sold prices (14,5), the two 5dp modeler knobs → all plain+expressionless, overriding Task 7/8's original "money" wording. Genuinely-2dp money boxes (wizard balances/amounts/net pay, tax inputs, thresholds, txn fees, current/new base, salary, dental/HSA, ESPP period bases) keep money kind with expressions ON — pinned from both directions (evaluates-where-money tests; ships-verbatim-where-not tests). Task 6's rate belt also opts out (`canonicalAmount(row.rate, { expressions: false })`, commit cefead7) since rate cells are percent-kind. `kind="shares"` counts display via formatShares (trailing-zero trim, value-lossless) — accepted.

---

### Task 1: `parseAmount` + `canonicalAmount` (`src/utils/amount.ts`)

**Files:**
- Create: `src/utils/amount.ts`
- Create: `src/utils/amount.test.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feature/data-entry-ergonomics-p1
```

- [ ] **Step 2: Write the failing tests**

Create `src/utils/amount.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalAmount, parseAmount } from './amount'

describe('parseAmount', () => {
  it('returns already-plain input VERBATIM (idempotence guarantee)', () => {
    // Never rewrite a server seed: '0.00' must not become '0', '+5' stays '+5'.
    for (const plain of ['1234.56', '0.00', '-5', '+5', '5.', '.5', '1500']) {
      expect(parseAmount(plain)).toEqual({ canonical: plain })
    }
  })
  it('trims surrounding whitespace to the plain form', () => {
    expect(parseAmount(' 1500 ')).toEqual({ canonical: '1500' })
  })
  it('strips $ and comma grouping', () => {
    expect(parseAmount('$1,234.56')).toEqual({ canonical: '1234.56' })
    expect(parseAmount('-$500')).toEqual({ canonical: '-500' })
    expect(parseAmount('$ 1,234')).toEqual({ canonical: '1234' })
    // Comma POSITIONS are not validated (spec §3.1 tolerance).
    expect(parseAmount('1,2,3')).toEqual({ canonical: '123' })
    // Interior spaces are grouping too ("1 234,56" locales paste them).
    expect(parseAmount('1 234.56')).toEqual({ canonical: '1234.56' })
  })
  it('reads accounting parentheses as negative', () => {
    expect(parseAmount('(1,234.56)')).toEqual({ canonical: '-1234.56' })
    expect(parseAmount('($500)')).toEqual({ canonical: '-500' })
    // A sign INSIDE parens is a double negative — refuse rather than guess.
    expect(parseAmount('(-5)')).toBeNull()
  })
  it('rejects exponent notation — closes the silent 1e5 hole', () => {
    expect(parseAmount('1e5')).toBeNull()
    expect(parseAmount('1E-3')).toBeNull()
  })
  it('rejects garbage, blanks, and digitless shells', () => {
    for (const bad of ['', '   ', 'abc', '.', '$', '()', '1.2.3', '5%', '--5', '$-500']) {
      expect(parseAmount(bad)).toBeNull()
    }
  })
})

describe('canonicalAmount', () => {
  it('canonicalizes what it can and hands back trimmed text otherwise', () => {
    expect(canonicalAmount('$1,600')).toBe('1600')
    expect(canonicalAmount(' 5 ')).toBe('5')
    expect(canonicalAmount('abc')).toBe('abc')
    expect(canonicalAmount('')).toBe('')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/utils/amount.test.ts`
Expected: FAIL — `Cannot find module './amount'` (or equivalent resolve error).

- [ ] **Step 4: Write the implementation**

Create `src/utils/amount.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/utils/amount.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/utils/amount.ts src/utils/amount.test.ts
git commit -m "feat: parseAmount/canonicalAmount — tolerant entry parsing with verbatim idempotence"
```

---

### Task 2: `quantize` lift, `=`-expression evaluator, `isAmount`

**Files:**
- Modify: `src/utils/amount.ts` (append)
- Modify: `src/utils/amount.test.ts` (append)
- Modify: `src/components/taxes/BracketsEditor.tsx:32-69` (delete local `quantize`/`addOne`, import instead)

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/amount.test.ts` (extend the import line to `{ canonicalAmount, evaluateAmount, isAmount, parseAmount, quantize }`):

```ts
describe('quantize (lifted from BracketsEditor — behavior pinned)', () => {
  it('rounds HALF_UP exactly like the server', () => {
    expect(quantize('100.005', 2)).toBe('100.01')
    expect(quantize('0.001', 2)).toBe('0.00')
    expect(quantize('9.999', 2)).toBe('10.00')
    expect(quantize('-100.005', 2)).toBe('-100.01') // ties away from zero
    expect(quantize('37', 2)).toBe('37.00')
  })
  it('hands non-plain text back untouched', () => {
    expect(quantize('abc', 2)).toBe('abc')
  })
})

describe('evaluateAmount', () => {
  it('evaluates =-prefixed arithmetic to a 2dp HALF_UP string', () => {
    expect(evaluateAmount('=1200+34.56')).toBe('1234.56')
    expect(evaluateAmount('=2*(3+4)')).toBe('14.00')
    expect(evaluateAmount('=10/4')).toBe('2.50')
    expect(evaluateAmount('=-5+10')).toBe('5.00')
    expect(evaluateAmount('=1/3')).toBe('0.33')
    expect(evaluateAmount('= 1 + 2 ')).toBe('3.00')
  })
  it('returns null for non-expressions and malformed ones', () => {
    for (const bad of ['1+2', '=1+', '=(1+2', '=5/0', '=1,000+5', '=abc', '=', '=1e5']) {
      expect(evaluateAmount(bad)).toBeNull()
    }
  })
  it('fences absurd magnitudes', () => {
    expect(evaluateAmount('=999999999999999*9')).toBeNull()
  })
})

describe('isAmount', () => {
  it('accepts plain, tolerant, and expression forms', () => {
    for (const ok of ['5', '$1,234.56', '(500)', '=1+2']) expect(isAmount(ok)).toBe(true)
  })
  it('rejects blanks, garbage, exponents, broken expressions', () => {
    for (const bad of ['', 'abc', '1e5', '=x', '=1+']) expect(isAmount(bad)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/amount.test.ts`
Expected: FAIL — `quantize`/`evaluateAmount`/`isAmount` not exported.

- [ ] **Step 3: Implement**

Append to `src/utils/amount.ts`:

```ts
/**
 * Round a plain decimal string to `places` decimals exactly the way the server will —
 * Decimal.quantize(..., ROUND_HALF_UP), ties away from zero. Lifted VERBATIM from
 * BracketsEditor (whose validate() must keep agreeing with the API's post-quantize
 * comparisons); non-plain text is handed back untouched.
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

/**
 * Evaluate a leading-"=" arithmetic entry ("=1200+34.56") to a 2dp HALF_UP plain decimal
 * string, or null when the text is not a well-formed expression. Float math is fine here
 * (receipt-scale sums); the RESULT is quantized through the same HALF_UP the server uses.
 * Grammar: expr = term (('+'|'-') term)*; term = factor (('*'|'/') factor)*;
 * factor = number | '(' expr ')' | ('+'|'-') factor. Plain decimal literals only —
 * no commas, no '$', no exponents inside an expression.
 */
export function evaluateAmount(raw: string): string | null {
  const text = raw.trim()
  if (!text.startsWith('=')) return null
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

/** One committable-entry test for validity gating: tolerant amount OR expression. */
export function isAmount(raw: string): boolean {
  return raw.trim().startsWith('=') ? evaluateAmount(raw) !== null : parseAmount(raw) !== null
}
```

Then extend `canonicalAmount` (replace its body) so expressions canonicalize too:

```ts
export function canonicalAmount(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('=')) return evaluateAmount(trimmed) ?? trimmed
  return parseAmount(trimmed)?.canonical ?? trimmed
}
```

Append to the `canonicalAmount` describe block in the test file:

```ts
  it('evaluates =-expressions at the wire boundary too', () => {
    expect(canonicalAmount('=1200+34.56')).toBe('1234.56')
    expect(canonicalAmount('=1+')).toBe('=1+')
  })
```

- [ ] **Step 4: Swap BracketsEditor onto the lifted quantize**

In `src/components/taxes/BracketsEditor.tsx`:
1. Delete the local `quantize` (lines 32-56) and `addOne` (lines 58-69) functions **including their doc comments**.
2. Add to the imports: `import { quantize } from '../../utils/amount'`.
Nothing else changes in this task — `validate()` keeps calling `quantize` identically.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/utils/amount.test.ts src/pages/TaxesPage.test.tsx`
Expected: PASS (TaxesPage suite proves the lift changed nothing).

- [ ] **Step 6: Commit**

```bash
git add src/utils/amount.ts src/utils/amount.test.ts src/components/taxes/BracketsEditor.tsx
git commit -m "feat: =-expression evaluator + isAmount; quantize lifted to utils/amount"
```

---

### Task 3: `<AmountInput>` — select-on-focus, blur commit, formatted echo, Escape

**Files:**
- Create: `src/components/AmountInput.tsx`
- Create: `src/components/AmountInput.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/AmountInput.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import AmountInput from './AmountInput'
import type { AmountKind } from './AmountInput'

afterEach(cleanup)

// The component is controlled; every test drives it through real parent state.
function Harness({ initial, kind }: { initial: string; kind?: AmountKind }) {
  const [value, setValue] = useState(initial)
  return <AmountInput aria-label="Amount" value={value} onValueChange={setValue} kind={kind} />
}

const box = () => screen.getByLabelText('Amount') as HTMLInputElement

it('shows the formatted echo while blurred and the raw state while focused', () => {
  render(<Harness initial="1500.00" />)
  expect(box().value).toBe('$1,500.00')
  fireEvent.focus(box())
  expect(box().value).toBe('1500.00')
  fireEvent.blur(box())
  expect(box().value).toBe('$1,500.00')
})

it('formats per kind', () => {
  render(<Harness initial="12.345678" kind="shares" />)
  expect(box().value).toBe('12.345678')
  cleanup()
  render(<Harness initial="13" kind="percent" />)
  expect(box().value).toBe('13%')
  cleanup()
  render(<Harness initial="2" kind="plain" />)
  expect(box().value).toBe('2')
})

it('selects all on focus (type-to-replace)', () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  expect(box().selectionStart).toBe(0)
  expect(box().selectionEnd).toBe('1500.00'.length)
})

it('canonicalizes tolerant text on blur', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '$1,600' } })
  fireEvent.blur(box())
  expect(box().value).toBe('$1,600.00') // state '1600', blurred echo formats it
  fireEvent.focus(box())
  expect(box().value).toBe('1600') // the canonical state, raw
})

it('evaluates =-expressions on blur', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '=1200+34.56' } })
  fireEvent.blur(box())
  fireEvent.focus(box())
  expect(box().value).toBe('1234.56')
})

it('leaves unparseable text verbatim and flags aria-invalid', () => {
  render(<Harness initial="" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: 'abc' } })
  fireEvent.blur(box())
  expect(box().value).toBe('abc')
  expect(box().getAttribute('aria-invalid')).toBe('true')
})

it('never flags a blank as invalid', () => {
  render(<Harness initial="" />)
  expect(box().getAttribute('aria-invalid')).toBeNull()
})

it('Escape restores the value the field had on focus', () => {
  render(<Harness initial="1500.00" />)
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value: '9' } })
  fireEvent.keyDown(box(), { key: 'Escape' })
  expect(box().value).toBe('1500.00')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/AmountInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/AmountInput.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { canonicalAmount, isAmount, parseAmount } from '../utils/amount'
import { formatCurrency, formatShares } from '../utils/format'
import './panels.css'

export type AmountKind = 'money' | 'shares' | 'percent' | 'plain'

// The blurred echo per kind — display-only, never state, never the wire (spec §3.3).
function echoOf(kind: AmountKind, canonical: string): string {
  if (kind === 'money') return formatCurrency(canonical)
  if (kind === 'shares') return formatShares(canonical)
  if (kind === 'percent') return `${canonical}%`
  return canonical
}

/**
 * The shared money/decimal box (spec 2026-08-21 §3.3/§3.4): select-all on focus,
 * canonicalize on commit, formatted echo while blurred, Escape-revert — plus the
 * data-entry-scope keyboard protocol. State stays the PARENT's raw string (the house
 * Record<id, string> pattern); this component only ever hands back canonical or verbatim
 * text through onValueChange.
 */
export default function AmountInput({
  value,
  onValueChange,
  kind = 'money',
  id,
  className,
  placeholder,
  disabled,
  autoFocus,
  'aria-label': ariaLabel,
}: {
  value: string
  onValueChange: (next: string) => void
  kind?: AmountKind
  id?: string
  className?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  'aria-label'?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  // What the field held when focus arrived — Escape's restore point.
  const atFocus = useRef(value)

  // Select AFTER the focused re-render swapped echo → raw: selecting inside onFocus would
  // select the echo text, and the swap would then collapse the selection. A DOM call, no
  // setState — the effect-body rule has nothing to say.
  useEffect(() => {
    if (focused) inputRef.current?.select()
  }, [focused])

  const commit = () => {
    const next = canonicalAmount(value)
    // isAmount gates the write: garbage stays VERBATIM so the parent's validators can
    // name it; only a real amount (or expression) is rewritten to canonical.
    if (isAmount(value) && next !== value) onValueChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onValueChange(atFocus.current)
      // Reselect once the restored value has rendered (microtasks run after React's
      // synchronous discrete-event flush).
      queueMicrotask(() => inputRef.current?.select())
      return
    }
    const scope = e.currentTarget.closest<HTMLElement>('[data-entry-scope]')
    if (scope === null) return // ledger rows: native Enter = implicit submit, arrows native
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')) {
      e.preventDefault() // Ctrl+S must never reach the browser's save dialog
      scope.querySelector<HTMLElement>('[data-entry-primary]')?.click()
      return
    }
    const backward = (e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp'
    const forward = (e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown'
    if (!backward && !forward) return
    e.preventDefault() // Enter inside a scope ADVANCES — it must not implicit-submit
    const cells = Array.from(scope.querySelectorAll<HTMLElement>('[data-entry-cell]'))
    const index = cells.indexOf(e.currentTarget)
    if (index === -1) return
    if (forward && index === cells.length - 1) {
      // Last cell: Enter-Enter finishes the step (focus the primary, next Enter clicks it).
      scope.querySelector<HTMLElement>('[data-entry-primary]')?.focus()
      return
    }
    cells[index + (forward ? 1 : -1)]?.focus() // the move blurs this cell → commit runs
  }

  const parsed = value.trim() === '' || value.trim().startsWith('=') ? null : parseAmount(value)
  const shown = focused || parsed === null ? value : echoOf(kind, parsed.canonical)
  const invalid = value.trim() !== '' && !isAmount(value)

  return (
    <input
      ref={inputRef}
      id={id}
      data-entry-cell=""
      className={`field-input${className ? ` ${className}` : ''}`}
      inputMode="decimal"
      autoFocus={autoFocus}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      value={shown}
      onChange={(e) => onValueChange(e.target.value)}
      onFocus={() => {
        atFocus.current = value
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={onKeyDown}
    />
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/AmountInput.test.tsx`
Expected: PASS. (If the `=`-on-blur test shows the raw expression while blurred: that is by design — an *uncommitted* expression has no echo; the test focuses first to read state.)

- [ ] **Step 5: Commit**

```bash
git add src/components/AmountInput.tsx src/components/AmountInput.test.tsx
git commit -m "feat: AmountInput — type-to-replace, blur canonicalize, formatted echo, Escape revert"
```

---

### Task 4: keyboard protocol tests (scope traversal + primary action)

The handlers shipped inside Task 3's `onKeyDown`; this task proves the protocol end-to-end and pins the outside-scope contract. Separate task so the traversal behavior gets its own red/green cycle and review.

**Files:**
- Modify: `src/components/AmountInput.test.tsx` (append)

- [ ] **Step 1: Write the (initially passing-or-failing) protocol tests**

Append to `src/components/AmountInput.test.tsx`:

```tsx
function ScopeHarness({ onPrimary }: { onPrimary?: () => void }) {
  const [a, setA] = useState('1.00')
  const [b, setB] = useState('2.00')
  return (
    <div data-entry-scope="">
      <AmountInput aria-label="First" value={a} onValueChange={setA} />
      <AmountInput aria-label="Second" value={b} onValueChange={setB} />
      <button type="button" data-entry-primary="" onClick={onPrimary}>
        Next step
      </button>
    </div>
  )
}

const first = () => screen.getByLabelText('First') as HTMLInputElement
const second = () => screen.getByLabelText('Second') as HTMLInputElement

it('Enter advances to the next cell; Shift+Enter goes back', () => {
  render(<ScopeHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter' })
  expect(document.activeElement).toBe(second())
  fireEvent.keyDown(second(), { key: 'Enter', shiftKey: true })
  expect(document.activeElement).toBe(first())
})

it('ArrowDown/ArrowUp traverse like Enter', () => {
  render(<ScopeHarness />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second())
  fireEvent.keyDown(second(), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(first())
})

it('Enter on the last cell focuses the primary action', () => {
  render(<ScopeHarness />)
  second().focus()
  fireEvent.keyDown(second(), { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next step' }))
})

it('Ctrl+Enter and Ctrl+S click the primary action from any cell', () => {
  let clicks = 0
  render(<ScopeHarness onPrimary={() => (clicks += 1)} />)
  first().focus()
  fireEvent.keyDown(first(), { key: 'Enter', ctrlKey: true })
  fireEvent.keyDown(first(), { key: 's', ctrlKey: true })
  expect(clicks).toBe(2)
})

it('commits the edited cell when Enter moves focus away', () => {
  render(<ScopeHarness />)
  fireEvent.focus(first())
  fireEvent.change(first(), { target: { value: '$1,600' } })
  fireEvent.keyDown(first(), { key: 'Enter' })
  fireEvent.blur(first()) // jsdom does not blur on .focus() of another node — simulate it
  fireEvent.focus(first())
  expect(first().value).toBe('1600')
})

it('outside a scope, Enter is left to native implicit submission', () => {
  let submitted = 0
  function RowForm() {
    const [v, setV] = useState('')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted += 1
        }}
      >
        <AmountInput aria-label="Amount" value={v} onValueChange={setV} />
        <button type="submit">Add</button>
      </form>
    )
  }
  render(<RowForm />)
  // jsdom does not run implicit submission itself; the contract under test is that the
  // component did NOT preventDefault outside a scope.
  const event = fireEvent.keyDown(box(), { key: 'Enter' })
  expect(event).toBe(true) // fireEvent returns false when preventDefault was called
  expect(submitted).toBe(0)
})
```

- [ ] **Step 2: Run, fix any gaps, re-run to green**

Run: `npx vitest run src/components/AmountInput.test.tsx`
Expected: PASS. If a traversal test fails, the defect is in Task 3's `onKeyDown` — fix it there (do not weaken the test).

- [ ] **Step 3: Commit**

```bash
git add src/components/AmountInput.test.tsx
git commit -m "test: pin the data-entry-scope keyboard protocol"
```

---

### Task 5: wizard adoption (`MonthlyUpdatePage`)

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx`
- Modify: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Update the page**

In `src/pages/MonthlyUpdatePage.tsx`:

1. Imports: add `import AmountInput from '../components/AmountInput'` and `import { canonicalAmount, isAmount } from '../utils/amount'`. Delete the local `isNumeric` function (lines 35-37).
2. Replace the two validity computations (lines 263-266):

```ts
  const balancesValid = accounts.every((a) => isAmount(balances[a.id] ?? ''))
  const amountsValid =
    categories.every((c) => isAmount(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isAmount(netPay))
```

3. The review-step preview (line 268's `useMemo`) must sum COMMITTED values so an
   uncommitted `=`/`$` entry previews correctly — replace every `Number(balances[a.id])`
   with `Number(canonicalAmount(balances[a.id] ?? ''))`, `Number(amounts[c.id])` with
   `Number(canonicalAmount(amounts[c.id] ?? ''))`, and `Number(netPay)` with
   `Number(canonicalAmount(netPay))`.
4. In `save()`, canonicalize the wire values:

```ts
        balances: accounts.map((a) => ({ account_id: a.id, balance: canonicalAmount(balances[a.id]) })),
```

```ts
        amounts: categories.map((c) => ({ category_id: c.id, amount: canonicalAmount(amounts[c.id]) })),
      }
      if (netPay.trim() !== '') body.net_pay = canonicalAmount(netPay)
```

5. Compute the autofocus target above the return (after `const anchor = …`):

```ts
  // The first RENDERED cell (groups render in GROUP_ORDER, not array order).
  const firstBalanceId = GROUP_ORDER.flatMap((g) => accounts.filter((a) => a.group === g))[0]?.id
```

6. Balances step: the card `<div className="card">` (line 402) becomes
   `<div className="card" data-entry-scope="">`; the "Next: spending" button gains
   `data-entry-primary=""`. Replace the balance `<input …>` (lines 443-451) with:

```tsx
                        <AmountInput
                          id={`bal-${account.id}`}
                          className={isAmount(value) ? undefined : 'invalid'}
                          autoFocus={account.id === firstBalanceId}
                          value={value}
                          onValueChange={(next) =>
                            setBalances((cur) => ({ ...cur, [account.id]: next }))
                          }
                        />
```

7. Spending step: its card `<div className="card">` (line 476) gains `data-entry-scope=""`;
   "Next: review" gains `data-entry-primary=""`. Net pay input (lines 484-490) becomes:

```tsx
              <AmountInput
                className={netPay.trim() === '' || isAmount(netPay) ? undefined : 'invalid'}
                autoFocus
                value={netPay}
                onValueChange={setNetPay}
                placeholder="leave blank to skip"
              />
```

   Category inputs (lines 499-507) become:

```tsx
                  <AmountInput
                    id={`amt-${category.id}`}
                    className={isAmount(value) ? undefined : 'invalid'}
                    value={value}
                    onValueChange={(next) =>
                      setAmounts((cur) => ({ ...cur, [category.id]: next }))
                    }
                  />
```

8. Leave the meta-row `recorded_on` (date) and `notes` (text) inputs untouched. Leave the review step untouched.

- [ ] **Step 2: Update the existing tests**

In `src/pages/MonthlyUpdatePage.test.tsx`, apply the display rule (focused = raw, blurred = formatted; the FIRST cell of each step autofocuses; `fireEvent.click` never blurs in jsdom):

- Line 82 (`Checking` on load): **unchanged** — `'1500.00'` (it autofocused → raw).
- Line 88 (`Food` after step change): becomes `'$0.00'` (netPay autofocused, Food is blurred).
- Line 97: unchanged (`getByText` matches text nodes, not input values).
- Line 162 (restored `Checking`): **unchanged** `'1600.00'` (autofocused).
- Line 167 (after Discard click — focus never left the input): **unchanged** `'1500.00'`.
- Line 183: **unchanged** `'1500.00'` (autofocused on the re-render).
- Line 193 (June `Checking`): **unchanged** `'0.00'` (autofocused).
- Line 200 (August restored): **unchanged** `'1600.00'`.
- Line 240: **unchanged** `'1500.00'`.

(Most assertions survive because the fixture's only account autofocuses. If any additional assertion trips, apply the display rule rather than weakening it to a regex.)

- [ ] **Step 3: Add the new behavior tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx`:

```tsx
it('canonicalizes tolerant and =-expression entries into the PUT bodies', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  fireEvent.change(balanceInput, { target: { value: '$1,600.00' } })
  fireEvent.click(screen.getByRole('button', { name: /next: spending/i }))
  fireEvent.change(await screen.findByLabelText('Food'), { target: { value: '=200+50' } })
  fireEvent.change(screen.getByLabelText('Net pay (take-home)'), { target: { value: '9,000' } })
  fireEvent.click(screen.getByRole('button', { name: /next: review/i }))
  fireEvent.click(await screen.findByRole('button', { name: /save month/i }))
  await waitFor(() => {
    // No blur ever fired (jsdom clicks do not blur): canonicalAmount at the wire
    // boundary is what keeps "$1,600.00" off a Decimal column.
    expect(netWorthApi.putMonthBalances).toHaveBeenCalledWith(
      '2026-08-01',
      expect.objectContaining({
        balances: [{ account_id: 1, balance: '1600.00' }],
      }),
    )
    expect(spendingApi.putSpendingMonth).toHaveBeenCalledWith('2026-08-01', {
      net_pay: '9000',
      amounts: [{ category_id: 7, amount: '250.00' }],
    })
  })
})

it('accepts spreadsheet-formatted text as valid entry', async () => {
  renderWizard()
  fireEvent.change(await screen.findByLabelText('Checking'), { target: { value: '$1,234.56' } })
  expect(
    (screen.getByRole('button', { name: /next: spending/i }) as HTMLButtonElement).disabled,
  ).toBe(false)
})

it('Enter on the last balance cell lands on the step primary', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  balanceInput.focus()
  fireEvent.keyDown(balanceInput, { key: 'Enter' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /next: spending/i }))
})

it('autofocuses the first balance cell on load', async () => {
  renderWizard()
  const balanceInput = await screen.findByLabelText('Checking')
  expect(document.activeElement).toBe(balanceInput)
})
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx`
Expected: PASS (all pre-existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat: wizard adopts AmountInput — keyboard flow, tolerant parsing, canonical wire bodies"
```

---

### Task 6: taxes adoption (`InputsForm` + `BracketsEditor`)

**Files:**
- Modify: `src/components/taxes/InputsForm.tsx`
- Modify: `src/components/taxes/BracketsEditor.tsx`
- Modify: `src/pages/TaxesPage.test.tsx` (display-rule fallout only)

- [ ] **Step 1: InputsForm**

1. Imports: add `import AmountInput from '../AmountInput'` and `import { canonicalAmount, isAmount } from '../../utils/amount'`. Delete the `PLAIN_DECIMAL` constant (lines 22-25).
2. Invalid detection (line 62) becomes: `if (next !== '' && !isAmount(next)) invalid.push(item.label)`.
3. In `submit()`, canonicalize the PUT body (the on-screen `changed` diff still counts raw text):

```ts
    putTaxInputs(inputs.year, {
      values: Object.fromEntries(
        Object.entries(changed).map(([key, text]) => [
          key,
          text === null ? null : canonicalAmount(text),
        ]),
      ),
    })
```

4. The `<form>` (line 113) gains `data-entry-scope=""`; the "Save inputs" submit button gains `data-entry-primary=""`. (Enter in a cell now ADVANCES — the scope preventDefaults it — and Ctrl+Enter clicks Save: the documented behavior change.)
5. Replace the item `<input …>` (lines 142-152) with:

```tsx
                    <AmountInput
                      id={id}
                      className={value !== '' && !isAmount(value) ? 'invalid' : undefined}
                      value={value}
                      onValueChange={(next) =>
                        setValues((current) => ({ ...current, [item.key]: next }))
                      }
                    />
```

(`kind` defaults to `'money'` — the suggestion chips already render every tax input through `formatCurrency`, so the echo speaks the same language.)

- [ ] **Step 2: BracketsEditor**

1. Imports: add `import AmountInput from '../AmountInput'` and extend the amount import to `import { canonicalAmount, quantize } from '../../utils/amount'`.
2. In `save(name)` (line 180), canonicalize before validating and shipping — replace the first line of the function body:

```ts
    const rows = (tables[name] ?? []).map((row) => ({
      rate: canonicalAmount(row.rate),
      threshold: canonicalAmount(row.threshold),
    }))
```

(`validate` and the PUT then read these canonical rows exactly as before; garbage still comes back verbatim from `canonicalAmount` and still trips the same worded errors.)
3. Each jurisdiction `<form className="bracket-block">` (line 238) gains `data-entry-scope=""`; its "Save" submit button (line 323) gains `data-entry-primary=""`.
4. Rate cell (lines 276-282) becomes:

```tsx
                        <AmountInput
                          aria-label={`${label(name)} bracket ${index + 1} rate (%)`}
                          kind="percent"
                          value={row.rate}
                          onValueChange={(next) => setRow(name, index, 'rate', next)}
                        />
```

5. Threshold cell (lines 285-291) becomes:

```tsx
                        <AmountInput
                          aria-label={`${label(name)} bracket ${index + 1} threshold`}
                          value={row.threshold}
                          onValueChange={(next) => setRow(name, index, 'threshold', next)}
                        />
```

Keep the existing `drill-hint` currency echo span (lines 294-296) — it is the only live echo visible **while typing**, which the blurred in-input echo does not cover.

- [ ] **Step 3: Run and fix display-rule fallout**

Run: `npx vitest run src/pages/TaxesPage.test.tsx`
Any failed assertion that reads a money input's `.value` while blurred now sees the formatted echo — update the expectation per the display rule (raw when focused via `fireEvent.focus`, formatted otherwise). Do not touch wire-body assertions: they must stay canonical.

- [ ] **Step 4: Commit**

```bash
git add src/components/taxes/InputsForm.tsx src/components/taxes/BracketsEditor.tsx src/pages/TaxesPage.test.tsx
git commit -m "feat: taxes forms adopt AmountInput — scoped keyboard flow, canonical PUT bodies"
```

---

### Task 7: portfolio panels adoption + input CSS unification

**Files:**
- Modify: `src/components/portfolio/TransactionsPanel.tsx`
- Modify: `src/components/portfolio/DividendsPanel.tsx`
- Modify: `src/components/portfolio/SecuritiesPanel.tsx`
- Modify: `src/components/portfolio/portfolio.css:66`
- Modify: `src/components/portfolio/TransactionsPanel.test.tsx`, `DividendsPanel.test.tsx`, `SecuritiesPanel.test.tsx` (display-rule fallout only)

These are ledger ROW forms — **no `data-entry-scope`**: Enter keeps its native submit-the-row meaning (locked decision 4).

- [ ] **Step 1: TransactionsPanel**

1. Imports: add `import AmountInput from '../AmountInput'` and `import { canonicalAmount } from '../../utils/amount'`.
2. `toPayload` (lines 37-55): canonicalize every decimal —

```ts
  if (form.type === 'split') {
    return { ...base, split_factor: canonicalAmount(form.split_factor), shares: '0', price: '0', fees: null }
  }
  return {
    ...base,
    shares: canonicalAmount(form.shares),
    price: canonicalAmount(form.price),
    fees: form.fees.trim() ? canonicalAmount(form.fees) : null,
    split_factor: null,
  }
```

3. Swap the four decimal inputs for AmountInputs (pattern; the surrounding `<label>` text stays, which keeps `getByLabelText` working):
   - Factor (lines 199-203): `<AmountInput kind="plain" value={form.split_factor} onValueChange={set('split_factor')} />`
   - Shares (lines 209-213): `<AmountInput kind="shares" value={form.shares} onValueChange={set('shares')} />`
   - Price (lines 217-221): `<AmountInput value={form.price} onValueChange={set('price')} />`
   - Fees (lines 225-229): `<AmountInput value={form.fees} onValueChange={set('fees')} />`
4. Give the remaining plain controls the shared chrome: the Account input (line 174) and Notes input (line 235) gain `className="field-input"`; the Date input (line 190) gains `className="field-input"`. The two `<select>`s keep the `.entry-form select` styling.

- [ ] **Step 2: DividendsPanel**

Same imports. Amount input (line 120) → `<AmountInput value={form.amount} onValueChange={(next) => setForm((f) => ({ ...f, amount: next }))} />`. In `submit()`, `amount: canonicalAmount(form.amount)`. Account (line 112) and Notes (line 124) inputs gain `className="field-input"`; Pay date (line 116) gains `className="field-input"`.

- [ ] **Step 3: SecuritiesPanel**

Same imports. Annual dividend input (lines 204-208) → `<AmountInput value={form.annual_dividend} onValueChange={set('annual_dividend')} />`; in the update body, `annual_dividend: form.annual_dividend.trim() ? canonicalAmount(form.annual_dividend) : null`. The manual-price mini-form input (lines 291-295) → `<AmountInput value={price} onValueChange={setPrice} />`; in `savePrice`, `putManualPrice(security.ticker, { price: canonicalAmount(price) })`. Ticker/Name/Industry inputs gain `className="field-input"`.

- [ ] **Step 4: Narrow the divergent CSS rule**

In `src/components/portfolio/portfolio.css` line 66, the rule
`.entry-form input, .entry-form select { … }` becomes select-only (text inputs now carry `.field-input`):

```css
.entry-form select { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 6px 8px; border-radius: 6px; }
```

(The checkbox opt-out rule on line 68 stays — its selector is independent.)

- [ ] **Step 5: Run and fix display-rule fallout**

Run: `npx vitest run src/components/portfolio`
Update any blurred-value assertions per the display rule; wire-body assertions stay canonical. Watch for `startEdit` tests: a row's `1234.5600` seed now displays `$1,234.56` while blurred — assert the echo, or `fireEvent.focus` first and assert the verbatim server string.

- [ ] **Step 6: Commit**

```bash
git add src/components/portfolio
git commit -m "feat: portfolio panels adopt AmountInput + field-input chrome; entry-form CSS narrowed to selects"
```

---

### Task 8: comp, RSU grants, paycheck, ESPP adoption

**Files:**
- Modify: `src/pages/CompPage.tsx`
- Modify: `src/components/comp/RsuGrantsPanel.tsx`
- Modify: `src/pages/PaycheckPage.tsx`
- Modify: `src/pages/EsppPage.tsx`
- Modify: their test files (display-rule fallout only)

All are row/profile forms — **no `data-entry-scope`** (Enter submits the row natively). Integer boxes (focal_year, shares, vest_quantum, pay_periods_per_year) stay plain inputs (locked decision 5).

- [ ] **Step 1: CompPage EventsPanel**

Imports: `import AmountInput from '../components/AmountInput'` and `import { canonicalAmount } from '../utils/amount'`.

1. `submit()`: `const blank = (field: keyof EventFormState) => { const text = form[field].trim(); return text === '' ? null : canonicalAmount(text) }` and `current_base: canonicalAmount(base)`.
2. Swap the six decimal inputs (each keeps its surrounding `<label>` text):
   - Current base (266-270) / New base (274-279): `<AmountInput value={…} onValueChange={set('…')} />`
   - Unvested RSUs (284-288) / Refresh RSUs (301-306): `kind="shares"`
   - Unvested price (292-297) / Grant price (310-315): default money kind.
   Notes and Focal year inputs stay as they are (already `.field-input`).

- [ ] **Step 2: RsuGrantsPanel**

Imports: add AmountInput + `{ canonicalAmount, isAmount }`; drop the now-unused `isPlainDecimal` import if nothing else uses it.
1. Price validation (line 154): `if (!isAmount(price))` …; positivity (line 161): `if (Number(canonicalAmount(price)) <= 0)`.
2. Body (line 200): `grant_price: canonicalAmount(price)`.
3. Price at grant input (335-340) → `<AmountInput value={form.grant_price} onValueChange={set('grant_price')} />`.

- [ ] **Step 3: PaycheckPage ProfilesPanel**

Imports: add AmountInput + `{ canonicalAmount, isAmount }`; keep `shiftPoint` (drop `isPlainDecimal` if unused after this).
1. Percent validation loop (lines 251-275): `if (text !== '' && !isAmount(text))` …, and the range check reads the canonical value: `const value = Number(canonicalAmount(text))`.
2. Body: `annual_salary: canonicalAmount(salary)`, `const pct = (field: PctField) => shiftPoint(canonicalAmount(form[field].trim() || '0'), -2)`, `dental_vision_per_check: canonicalAmount(form.dental_vision_per_check.trim() || '0')`, `hsa_per_check: canonicalAmount(form.hsa_per_check.trim() || '0')`.
3. Inputs: Annual salary (372-377) → `<AmountInput value={form.annual_salary} onValueChange={set('annual_salary')} />`; the five `PCT_FIELDS` inputs (391-397) → `<AmountInput kind="percent" value={form[field]} onValueChange={set(field)} />`; Dental & vision (401-406) and HSA (410-415) → money AmountInputs. Pay periods, Effective date, Notes stay as-is.

- [ ] **Step 4: EsppPage (three forms)**

Read the file first; apply the identical transformation to every `inputMode="decimal"` input in **LotsPanel** (shares → `kind="shares"`; subscription/FMV/purchase price/sold price → money), **ModelerCard** (its three knobs: percent-labelled knob → `kind="percent"`, money knobs → money), and **PeriodsPanel** (semi_annual_base/additional_payments → money; contribution_pct → `kind="percent"`). Wherever the submit/compute handlers read those form fields into a payload or `isPlainDecimal` gate, route the value through `canonicalAmount(…)` and swap `isPlainDecimal(x)` gates to `isAmount(x)` with range checks reading `Number(canonicalAmount(x))` — exactly the Task 8 Step 3 paycheck pattern. Percent fields keep their `shiftPoint` conversions, applied to the canonical value. Date inputs and label/notes text inputs stay as they are.

- [ ] **Step 5: Run and fix display-rule fallout**

Run: `npx vitest run src/pages/PaycheckPage.test.tsx src/pages/TaxesPage.test.tsx && npx vitest run src/components/comp src/pages`
Update blurred-value assertions per the display rule only; wire bodies stay canonical. `formFrom`/`startEdit` seeds (server strings like `"0.130000000"` shifted to `"13"`) now echo `13%` while blurred — assert the echo or focus first.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat: comp/grants/paycheck/espp adopt AmountInput with canonical payloads"
```

---

### Task 9: full-suite gates + adoption-completeness sweep

**Files:**
- Possibly small fixes anywhere in `src/` (fallout only)

- [ ] **Step 1: Adoption-completeness grep**

Run: `grep -rn 'inputMode="decimal"' src --include='*.tsx' | grep -v AmountInput.tsx`
Expected: **only** the deliberate exclusions — ProjectionPage knobs, WhatIfPanel legs, SettingsPage (if any), and integer boxes that use `inputMode="numeric"` won't match at all. Any OTHER hit inside the adopted surfaces (wizard, taxes, portfolio, comp, espp, paycheck) is a missed site: adopt it per its task's pattern.

- [ ] **Step 2: Full gates**

```bash
npm run test        # full vitest — expect 554 pre-existing + this phase's additions, all green
npm run lint        # exactly 1 sanctioned AuthContext warning, nothing new
npx tsc -b
npm run build       # EChart chunk must remain 700.93 kB (charts untouched)
```

Fix any fallout; a display-rule test failure is updated per the rule, never regex-weakened.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A src
git commit -m "fix: phase-1 gates sweep fallout"
```

(Skip the commit if Step 2 needed no changes.)

- [ ] **Step 4: Hand to the final whole-branch review**

Per repo convention: dispatch the final code review of the whole branch diff vs `main`; fix Critical/Important findings on-branch; then ff-merge to `main` and delete the branch. The user pushes.

---

## Self-review (spec §3 coverage)

- §3.1 `parseAmount` + idempotence → Task 1. Percent boxes gain tolerance via `isAmount`/`canonicalAmount` before `shiftPoint` → Tasks 6 (rate cells), 8 (paycheck/ESPP pct). Integer regexes untouched → locked decision 5.
- §3.2 `=` arithmetic, quantize lift, money-boxes-only → Task 2 (evaluator), wired via commit/canonicalAmount in every adopted money box; integer/date boxes never AmountInputs.
- §3.3 component behaviors → Task 3. Portfolio CSS rider → Task 7 Step 4.
- §3.4 keyboard protocol + primaries + autofocus + documented tax-form Enter change → Tasks 3/4 (protocol), 5 (wizard scopes + autofocus), 6 (tax scopes). Ledger focus-return formally completes in Phase 3 (spec §3.4's own note); the component's `autoFocus` prop is the shipped mechanism.
- §3.5 adoption map → Tasks 5-8; completeness grep in Task 9.
- §6 invariants: wire canonical (canonicalAmount everywhere + Task 5's no-blur PUT test); draft no-spurious-dirt (Task 1 idempotence test + wizard draft tests unchanged); aria-invalid rider (Task 3).
