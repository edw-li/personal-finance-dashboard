import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverDismiss } from '../usePopoverDismiss'
import BusyButton from './BusyButton'
import { placeConfirm } from './confirmPlacement'
import '../panels.css'
import './feedback.css'

export interface ConfirmOptions {
  /** The control that asked: the popover sits beside it, and focus returns to it. */
  anchor: HTMLElement
  /** "Delete tax year 2025?" */
  title: string
  /** What will be lost, or what happens. */
  body?: ReactNode
  /** "Delete 2025" */
  confirmLabel: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** Default 'danger'. */
  tone?: 'danger' | 'default'
  /** Restore only: Confirm stays quiet until the typed text matches `expected`. */
  typedArm?: { expected: string; prompt: string }
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

interface Question {
  id: number
  options: ConfirmOptions
  answer: (yes: boolean) => void
}

const ConfirmContext = createContext<Ask | null>(null)

/**
 * The one in-app confirm (2026-09-25 polish spec D2, §6.3; contract C3), mounted once in App.tsx inside
 * the ToastProvider. `useConfirm()(options)` opens a popover beside `options.anchor` and resolves true
 * (Confirm) or false (Cancel, Escape, a pointerdown outside, or a newer question). It replaces
 * `window.confirm`, which left the app — noNativeConfirm.test.ts fences that out.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [question, setQuestion] = useState<Question | null>(null)
  // The live question, for the async paths (a second ask, a settle) that must not trust the closure of
  // the render that made them.
  const live = useRef<Question | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const nextId = useRef(1)

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const previous = live.current
        const next: Question = { id: nextId.current, options, answer: resolve }
        nextId.current += 1
        live.current = next
        anchorRef.current = options.anchor
        setQuestion(next)
        // One question at a time: a newer one answers the older "no". Its popover is replaced, and the
        // focus goes to the new one's Cancel rather than back to the old anchor.
        previous?.answer(false)
      }),
    [],
  )

  const settle = useCallback((settled: Question, yes: boolean) => {
    if (live.current !== settled) return
    live.current = null
    setQuestion(null)
    // Back to the control that asked, if it is still there to take it — before the answer, so whatever
    // the caller does next starts from there.
    if (settled.options.anchor.isConnected) settled.options.anchor.focus()
    settled.answer(yes)
  }, [])

  // A question the provider can no longer show (it unmounted: a logout) answers "no" — a promise left
  // pending would hold its caller forever. Answering twice is harmless: a promise settles once.
  useEffect(() => {
    if (question === null) return
    return () => question.answer(false)
  }, [question])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {question !== null &&
        createPortal(
          <ConfirmPopover key={question.id} question={question} anchorRef={anchorRef} onSettle={settle} />,
          document.body,
        )}
    </ConfirmContext.Provider>
  )
}

const unprovided: Ask = () => {
  throw new Error('useConfirm() asked outside a <ConfirmProvider> — App.tsx mounts one; a test renders its own')
}

/** The ask. Outside a ConfirmProvider (a test rendering its host bare) it still renders, and throws
 *  only when asked: a question nobody can see must never quietly answer "no". */
// eslint-disable-next-line react-refresh/only-export-components -- C3 names ONE module for the provider and its hook (ToastProvider's shape); a hot edit here reloads the page instead
export function useConfirm(): Ask {
  return useContext(ConfirmContext) ?? unprovided
}

function ConfirmPopover({
  question,
  anchorRef,
  onSettle,
}: {
  question: Question
  anchorRef: RefObject<HTMLElement | null>
  onSettle: (question: Question, yes: boolean) => void
}) {
  const { options } = question
  const { anchor, typedArm } = options
  const tone = options.tone ?? 'danger'
  const surfaceRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const [typed, setTyped] = useState('')
  const armed = typedArm === undefined || typed.trim() === typedArm.expected
  const cancel = useCallback(() => onSettle(question, false), [onSettle, question])
  const confirm = () => {
    if (armed) onSettle(question, true)
  }

  // Escape (caught in the capture phase, ahead of the detail panel's own) and a pointerdown outside
  // both the popover and its anchor answer "no" — the house dismissal contract.
  usePopoverDismiss(true, cancel, anchorRef, surfaceRef)

  // Beside the anchor before the first paint, and after it on every scroll (capture: scroll events do
  // not bubble) and resize. An anchor that has left the page takes its question with it.
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const place = () => {
      if (!anchor.isConnected) {
        cancel()
        return
      }
      const spot = placeConfirm(
        anchor.getBoundingClientRect(),
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      )
      surface.style.top = `${spot.top}px`
      surface.style.left = `${spot.left}px`
      surface.dataset.placement = spot.placement
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, cancel])

  // Cancel first (spec D2): the safe answer is the one under the caret.
  useLayoutEffect(() => {
    cancelRef.current?.focus({ preventScroll: true })
  }, [])

  // Tab walks the popover's own controls and wraps at both ends.
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const stops = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (first === undefined || last === undefined) return
    const edge = event.shiftKey ? first : last
    if (document.activeElement !== edge) return
    event.preventDefault()
    const wrapTo = event.shiftKey ? last : first
    wrapTo.focus()
  }

  return (
    <div
      ref={surfaceRef}
      className="popover-surface confirm-popover"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={options.body === undefined ? undefined : bodyId}
      data-tone={tone}
      onKeyDown={trapTab}
    >
      <p id={titleId} className="confirm-popover-title">
        {options.title}
      </p>
      {options.body !== undefined && (
        <div id={bodyId} className="confirm-popover-body">
          {options.body}
        </div>
      )}
      {typedArm !== undefined && (
        <label className="confirm-popover-arm">
          {typedArm.prompt}
          <input
            className="field-input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              confirm()
            }}
          />
        </label>
      )}
      <div className="confirm-popover-actions">
        <button ref={cancelRef} type="button" className="button" onClick={cancel}>
          {options.cancelLabel ?? 'Cancel'}
        </button>
        <BusyButton
          type="button"
          className={tone === 'danger' ? 'button danger-button' : 'button button-primary'}
          aria-disabled={!armed}
          onClick={confirm}
        >
          {options.confirmLabel}
        </BusyButton>
      </div>
    </div>
  )
}
