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
 * text through onValueChange. "=" arithmetic is enabled for kind="money" ONLY — the
 * evaluator quantizes to 2dp, which is wrong for shares/factor columns (plan amendment).
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
  const expressions = kind === 'money'

  // Select AFTER the focused re-render swapped echo → raw: selecting inside onFocus would
  // select the echo text, and the swap would then collapse the selection. A DOM call, no
  // setState — the effect-body rule has nothing to say.
  useEffect(() => {
    if (focused) inputRef.current?.select()
  }, [focused])

  const commit = () => {
    const next = canonicalAmount(value, { expressions })
    // isAmount gates the write: garbage stays VERBATIM so the parent's validators can
    // name it; only a real amount (or money expression) is rewritten to canonical.
    if (isAmount(value, { expressions }) && next !== value) onValueChange(next)
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
  const invalid = value.trim() !== '' && !isAmount(value, { expressions })

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
