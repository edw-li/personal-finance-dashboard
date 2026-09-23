import { MOTION_MS } from '../../theme/motion'

// The reader's own input ends a hold at once: their scroll always wins over ours.
const INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

// When the reader last pressed, pointed or typed anywhere on the page (review round 1). A drill
// holds its chart only for a change THEY made after the chart was already in front of them — a
// click, Show details, a month-ribbon pick — never for one the page made on its own: a new page,
// Back, a ?month= the URL arrived with landing after the data does. ChartCard reads it.
let lastInput = Number.NEGATIVE_INFINITY
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'click'] as const) {
    window.addEventListener(type, () => { lastInput = performance.now() }, { capture: true, passive: true })
  }
}

/** Whether the reader has pressed, pointed or typed since `time` (a performance.now() stamp). */
export function inputSince(time: number): boolean {
  return lastInput > time
}

/** The dock's margin transition (--t-page), then ECharts' refit and a settle frame. */
export const HOLD_MS = MOTION_MS.page + 360

/**
 * Keeps `element`'s top edge where it is on screen while the layout around it settles
 * (2026-09-23 spec §C10, charts F1): a chart drill docks the detail panel, the page narrows over
 * --t-page, text above the chart rewraps, and the clicked chart used to slide ~350px down under
 * the pointer. Measures NOW — call it before the change — then corrects the window's scroll each
 * frame until `durationMs` has passed, the element leaves the page, or the reader scrolls, types
 * or points. Under reduced motion the margin lands in one commit and the first frame corrects it
 * before paint. Returns the cancel.
 */
export function holdPosition(
  element: HTMLElement | null | undefined,
  durationMs: number = HOLD_MS,
): () => void {
  if (!element || typeof requestAnimationFrame !== 'function') return () => {}
  const origin = element.getBoundingClientRect().top
  const until = performance.now() + durationMs
  let frame = 0
  let done = false
  const stop = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    for (const type of INPUT_EVENTS) window.removeEventListener(type, stop, true)
  }
  const tick = () => {
    if (done) return
    if (!element.isConnected) {
      stop()
      return
    }
    const drift = element.getBoundingClientRect().top - origin
    // Sub-pixel drift is layout rounding, not movement: correcting it would jitter.
    if (Math.abs(drift) >= 1) window.scrollBy({ top: drift, behavior: 'instant' })
    if (performance.now() >= until) {
      stop()
      return
    }
    frame = requestAnimationFrame(tick)
  }
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, stop, { capture: true, passive: true })
  }
  frame = requestAnimationFrame(tick)
  return stop
}
