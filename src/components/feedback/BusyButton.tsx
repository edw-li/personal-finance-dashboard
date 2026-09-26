import { useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'
import '../panels.css'
import './feedback.css'

export type BusyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** This button's own action is in flight: a spinner, aria-busy, and quiet. */
  busy?: boolean
  /** The label while busy (the width stays locked to the idle width — see the lock below). */
  busyLabel?: string
  /** Another action is in flight: quiet, label unchanged. NOT the HTML `inert` attribute — that would
   *  take the button out of the focus order, the one thing this component exists to prevent. */
  inert?: boolean
  /** React 19 ref-as-prop, for a caller that hands focus back to this button. */
  ref?: Ref<HTMLButtonElement>
}

/** The least padding left on each side when busy content spills into it. */
const SPILL_FLOOR_PX = 2

/**
 * The house button for anything that runs a request (2026-09-25 polish spec D3, §6.3; contract C3).
 * It never sets the native `disabled` attribute: a disabled button drops the focus it holds, and focus
 * must never fall to <body> mid-save. It goes quiet instead — `aria-disabled="true"` while busy, inert
 * or asked to (`aria-disabled`, or a `disabled` prop, honoured the same way) — and a click or a form
 * submit is swallowed while quiet. Busy draws a spinner before the label and holds the idle width.
 *
 * Pass the house `.button` class: its inline-flex row is what lets the spinner spill evenly into the
 * paddings while the idle width is held to the pixel. Without a flex row only the min-width holds, so
 * the button may grow while busy (feedback.css still gives it the quiet and busy looks).
 */
export default function BusyButton({
  busy = false,
  busyLabel,
  inert = false,
  disabled = false,
  className,
  children,
  onClick,
  ref,
  ...rest
}: BusyButtonProps) {
  const own = useRef<HTMLButtonElement>(null)
  // The width the button stands at when nothing is in flight — read by the lock below.
  const idleWidth = useRef(0)
  useImperativeHandle(ref, () => own.current as HTMLButtonElement, [])

  const asked = rest['aria-disabled']
  const quiet = busy || inert || disabled || asked === true || asked === 'true'

  // The idle width, measured at mount and whenever the idle button resizes (a label change, a density
  // switch, a late font). The observer's border box is the laid-out width, which the press transform
  // (.button:active's scale) never touches; without ResizeObserver (jsdom) the mount measure stands.
  useLayoutEffect(() => {
    const el = own.current
    if (el === null) return
    if (el.getAttribute('aria-busy') !== 'true') idleWidth.current = el.getBoundingClientRect().width
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (el.getAttribute('aria-busy') === 'true') return
      idleWidth.current = entry?.borderBoxSize?.[0]?.inlineSize ?? el.getBoundingClientRect().width
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // While busy, hold the idle width: min-width always (a shorter busy label never shrinks the button),
  // and the max-width too wherever the button's own padding can take the extra content — the spinner —
  // on a flex row, centred (feedback.css), so it spills evenly into both sides; a row that is not flex
  // could only overflow one way. A busy label too long for the padding grows the button rather than
  // clip. What was there before comes back when the work ends.
  useLayoutEffect(() => {
    const el = own.current
    const width = idleWidth.current
    if (!busy || el === null || width <= 0) return
    const before = { min: el.style.minWidth, max: el.style.maxWidth }
    el.style.minWidth = `${width}px`
    const spill = (el.getBoundingClientRect().width - width) / 2
    if (spill > 0) {
      const style = getComputedStyle(el)
      const room = Math.min(parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingRight) || 0)
      if (style.display.endsWith('flex') && spill <= room - SPILL_FLOOR_PX) el.style.maxWidth = `${width}px`
    }
    return () => {
      el.style.minWidth = before.min
      el.style.maxWidth = before.max
    }
  }, [busy, busyLabel])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (quiet) {
      // Swallowed the way a disabled button swallows it: no default action (a submit button's form
      // never submits) and no bubbling to a clickable row around it.
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...rest}
      ref={own}
      className={className === undefined ? 'busy-button' : `${className} busy-button`}
      aria-busy={busy ? true : undefined}
      aria-disabled={quiet ? true : undefined}
      onClick={handleClick}
    >
      {busy && <span className="busy-spinner" aria-hidden="true" />}
      <span className="busy-button-label">{busy && busyLabel !== undefined ? busyLabel : children}</span>
    </button>
  )
}
