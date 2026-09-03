import { Info } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import './panels.css'

// The bubble's max-width, kept in step with panels.css: the flip decision is "would the
// widest it can get run off the right edge?", so the number has to be the CSS one.
const BUBBLE_MAX_PX = 280

// A pointer crossing a row of tiles must not strobe three bubbles on its way past.
const HOVER_DELAY_MS = 150

// The ⓘ beside titles and tile labels. A real disclosure now (2026-09-03 shell spec §13):
// hover opens after a beat, click PINS it (the text is often two lines — the pointer has to
// be free to leave), Escape and an outside click unpin, and the bubble flips to the left
// when it would run off the viewport's right edge. The old pure-CSS ::after could express
// none of that and clipped on every right-hand card.
export default function InfoHint({ text }: { text: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [flip, setFlip] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Measured HERE, in the open path, not in an effect: the wrapper is already laid out
  // (only the bubble is conditional), so the side is decided before the bubble ever
  // paints — no flash on the wrong edge, and no setState from an effect body.
  const openNow = useCallback(() => {
    const el = wrapRef.current
    if (el !== null) setFlip(el.getBoundingClientRect().left + BUBBLE_MAX_PX > window.innerWidth)
    setOpen(true)
  }, [])

  const cancelPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const show = () => {
    cancelPending()
    timer.current = setTimeout(openNow, HOVER_DELAY_MS)
  }

  const hide = () => {
    cancelPending()
    if (!pinned) setOpen(false)
  }

  // A hover that scheduled an open and then unmounted (a page swap under the pointer)
  // would otherwise fire setState into a dead tree.
  useEffect(() => cancelPending, [cancelPending])

  useEffect(() => {
    if (!open) return
    const el = wrapRef.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false)
        setOpen(false)
      }
    }
    // mousedown, not click: the bubble goes away as the next gesture BEGINS, so a click
    // aimed at something behind it never lands on a stale overlay.
    const onDown = (e: MouseEvent) => {
      if (el !== null && !el.contains(e.target as Node)) {
        setPinned(false)
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="info-hint-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        className="info-hint"
        aria-label={text}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={openNow}
        onBlur={() => {
          if (!pinned) setOpen(false)
        }}
        onClick={() => {
          setPinned((p) => !p)
          openNow()
        }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="tooltip" className={`info-hint-bubble${flip ? ' is-flipped' : ''}`}>
          {text}
        </span>
      )}
    </span>
  )
}
