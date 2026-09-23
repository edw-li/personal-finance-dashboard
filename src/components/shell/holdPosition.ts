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

// Chromium's scroll anchoring moves the scroll position itself when content above the viewport
// changes size. During a hold that would read as someone else's scroll — and keeping the page
// still through the reflow is the hold's own job — so it is off on the root while any hold runs.
// A count, so overlapping holds (a deep link landing as a drill docks) restore it once.
let anchoringOff = 0
let anchoringBefore = ''
function suspendScrollAnchoring(): () => void {
  const root = document.documentElement
  if (anchoringOff++ === 0) {
    anchoringBefore = root.style.overflowAnchor
    root.style.overflowAnchor = 'none'
  }
  let resumed = false
  return () => {
    if (resumed) return
    resumed = true
    if (--anchoringOff === 0) root.style.overflowAnchor = anchoringBefore
  }
}

/**
 * Keeps `element`'s top edge where it is on screen while the layout around it settles
 * (2026-09-23 spec §C10, charts F1): a chart drill docks the detail panel, the page narrows over
 * --t-page, text above the chart rewraps, and the clicked chart used to slide ~350px down under
 * the pointer. Measures NOW — call it before the change — then corrects the window's scroll each
 * frame until `durationMs` has passed, the element leaves the page, the reader scrolls, types or
 * points, or the window moves anywhere the hold did not put it (review round 1: a scrollbar drag
 * fires no input event, and a restore or a focus scroll is someone else's too). Under reduced
 * motion the margin lands in one commit and the first frame corrects it before paint. Returns the
 * cancel.
 */
export function holdPosition(
  element: HTMLElement | null | undefined,
  durationMs: number = HOLD_MS,
): () => void {
  if (!element || typeof requestAnimationFrame !== 'function') return () => {}
  const origin = element.getBoundingClientRect().top
  const until = performance.now() + durationMs
  // Where the window stands now, and after each of the hold's own corrections.
  let expectedY = window.scrollY
  const resumeAnchoring = suspendScrollAnchoring()
  let frame = 0
  let done = false
  const stop = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    resumeAnchoring()
    for (const type of INPUT_EVENTS) window.removeEventListener(type, stop, true)
  }
  const tick = () => {
    if (done) return
    if (!element.isConnected || Math.abs(window.scrollY - expectedY) >= 1) {
      stop()
      return
    }
    const drift = element.getBoundingClientRect().top - origin
    // Sub-pixel drift is layout rounding, not movement: correcting it would jitter.
    if (Math.abs(drift) >= 1) {
      const before = window.scrollY
      window.scrollBy({ top: drift, behavior: 'instant' })
      expectedY = window.scrollY
      // The element must have moved exactly as far as the window did (a page end may cut the
      // scroll short). One that does not follow the page — sticky while pinned, fixed, in the top
      // layer like the Expand dialog — keeps its drift whatever the window does, and re-applying
      // it every frame ran the page away (code review: 2000 → 342 under Projection's pinned
      // chart). Give that scroll back and let go.
      const moved = expectedY - before
      if (Math.abs(element.getBoundingClientRect().top - origin - (drift - moved)) >= 1) {
        window.scrollTo({ top: before, behavior: 'instant' })
        expectedY = before
        stop()
        return
      }
    }
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
