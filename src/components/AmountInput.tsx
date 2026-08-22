import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { canonicalAmount, isAmount, parseAmount } from '../utils/amount'
import { formatCurrency, formatShares } from '../utils/format'
import './panels.css'

export type AmountKind = 'money' | 'shares' | 'percent' | 'plain'

// The blurred echo per kind — display-only, never state, never the wire (spec §3.3).
function echoOf(kind: AmountKind, canonical: string): string {
  if (kind === 'money') return formatCurrency(canonical)
  if (kind === 'shares') return formatShares(canonical)
  // A half-typed "13." would echo as "13.%"; the orphan point is display noise, so it is
  // dropped HERE only — parseAmount keeps "13." verbatim in state (idempotence contract).
  if (kind === 'percent') return `${canonical.replace(/\.$/, '')}%`
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
  // Armed at focus, disarmed by an already-focused mousedown, spent by the focusing click's
  // mouseup — see onMouseDown/onMouseUp.
  const selectPending = useRef(false)
  const expressions = kind === 'money'

  // Select AFTER the focused re-render swapped echo → raw: selecting inside onFocus would
  // select the echo text, and the swap would then collapse the selection. Layout, not
  // passive: the selection must land in the same frame the raw text appears, or a fast
  // tab-through paints one frame of unselected text and the first keystroke appends
  // instead of replacing. A DOM call, no setState — the effect-body rule has nothing to say.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select()
  }, [focused])

  const commit = () => {
    const next = canonicalAmount(value, { expressions })
    // isAmount gates the write: garbage stays VERBATIM so the parent's validators can
    // name it; only a real amount (or money expression) is rewritten to canonical.
    if (isAmount(value, { expressions }) && next !== value) onValueChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An Enter that CONFIRMS an IME composition belongs to the input method, not to us.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      // The first Escape cancels the CELL edit and is consumed, like a spreadsheet's; an
      // Escape on an untouched cell belongs to the container instead — it must reach a
      // parent modal to close it, and must not write back through onValueChange, whose
      // upstream setters mark the draft dirty.
      if (value === atFocus.current) return
      e.preventDefault()
      e.stopPropagation()
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
    // Arrows traverse only UNMODIFIED: Shift+Arrow selects text, Alt/Ctrl/Meta+Arrow are
    // the platform's word/line jumps, and hijacking them would break editing inside a cell.
    // Enter keeps its Shift pairing — Shift+Enter is the protocol's "go back".
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    const backward = (e.key === 'Enter' && e.shiftKey) || (e.key === 'ArrowUp' && plain)
    const forward = (e.key === 'Enter' && !e.shiftKey) || (e.key === 'ArrowDown' && plain)
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
        selectPending.current = true // re-armed on EVERY focus, so every click-in selects
        setFocused(true)
      }}
      onMouseDown={() => {
        // A focusing click's mousedown fires BEFORE focus, so the guard survives it; a click
        // on an ALREADY-focused field disarms here, before its own mouseup places the caret.
        if (document.activeElement === inputRef.current) selectPending.current = false
      }}
      onMouseUp={(e) => {
        // Browsers place the caret on the mouseup that COMPLETES a focusing click, which
        // collapses the selection focus just applied. Swallowing that one mouseup keeps
        // type-to-replace working for mouse users; the NEXT click (field already focused)
        // positions the caret normally — a spreadsheet's click-then-click-to-edit.
        if (selectPending.current) {
          e.preventDefault()
          selectPending.current = false
        }
      }}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={onKeyDown}
    />
  )
}
