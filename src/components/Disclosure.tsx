import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react'
// panels.css first (it owns the body's pop-in and the summary's hover transition), then the
// primitive's own sheet on top — Segmented pins its import order the same way.
import './panels.css'
import './disclosure.css'

// THE disclosure (2026-09-13 polish §2.6, §11): one <details> grammar for every "show me more"
// that is neither a form nor a menu — ChartTable, a selection's calculation, the assistant's
// reasoning blocks, Paycheck's employer match, Taxes' methodology notes. A rotating chevron
// replaces the UA triangle, the summary reads as an eyebrow row with the house focus ring, and
// the body pops in (panels.css). Uncontrolled by default: the browser owns `open` and this
// component only reports it. Pass `open` to control it — the summary's activation is then
// cancelled and the parent decides. `onOpen` fires ONCE, on the first open (the cue for a lazy
// load behind a summary, like the wizard's history list), including a mount that starts open.
export default function Disclosure({
  summary,
  children,
  defaultOpen = false,
  open,
  onToggle,
  onOpen,
  className,
  id,
  name,
}: {
  summary: ReactNode
  children: ReactNode
  /** Uncontrolled initial state. Ignored when `open` is given. */
  defaultOpen?: boolean
  /** Controlled state — the parent flips it from `onToggle`. */
  open?: boolean
  onToggle?: (open: boolean) => void
  /** Fires once, on the first open. */
  onOpen?: () => void
  className?: string
  id?: string
  /** Native exclusive accordion: <details> sharing a name close each other. */
  name?: string
}) {
  const controlled = open !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = controlled ? open : uncontrolledOpen
  const openedRef = useRef(false)
  useEffect(() => {
    if (!isOpen || openedRef.current) return
    openedRef.current = true
    onOpen?.()
  }, [isOpen, onOpen])
  // The browser's own toggle (uncontrolled): read the new state off the element and report it.
  // Any programmatic change to `open` fires `toggle` too — React's mount write included, which is
  // what the equality guard swallows — and the controlled branch ignores the event outright: the
  // parent made the change, it already knows.
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (controlled) return
    const next = event.currentTarget.open
    if (next === uncontrolledOpen) return
    setUncontrolledOpen(next)
    onToggle?.(next)
  }
  // Controlled: cancelling the summary's activation keeps the DOM's `open` equal to the prop; the
  // parent hears the request and re-renders — or does not, and the details stays as it was.
  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    if (!controlled) return
    event.preventDefault()
    onToggle?.(!open)
  }
  return (
    <details
      id={id}
      name={name}
      className={`disclosure${className === undefined ? '' : ` ${className}`}`}
      open={isOpen}
      onToggle={handleToggle}
    >
      <summary onClick={handleSummaryClick}>
        <ChevronRight size={14} aria-hidden="true" className="disclosure-chevron" />
        <span className="disclosure-summary">{summary}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
