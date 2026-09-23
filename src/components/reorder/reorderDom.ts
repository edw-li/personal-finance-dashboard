// Drag to reorder — the DOM half (2026-09-23 spec §2.3). The hook measures rows once at lift and
// then reasons in LIST coordinates (px from the top of the scroll container's content), so an
// auto-scroll in the middle of a drag never invalidates a measurement: only the pointer is
// re-converted, on every move and every scroll.
import { AUTO_SCROLL_EDGE } from './reorderMath'
import type { Extent } from './reorderMath'

/** The element that scrolls the list, or null for the page. */
export type Scroller = HTMLElement | null

/** The nearest ancestor that actually scrolls vertically (the Settings tables' 420px
 *  `.settings-scroll`), or null when the page does. More than 1px of overhang: a box with only
 *  `overflow-x: auto` (.holdings-scroll) computes `overflow-y: auto` too, and display scaling can
 *  round its content 1px taller than its box — that box must not steal the page's auto-scroll. */
export function scrollParentOf(element: Element | null | undefined): Scroller {
  let node = element?.parentElement ?? null
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight - node.clientHeight > 1) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** A client y in list coordinates. */
export function listY(scroller: Scroller, clientY: number): number {
  if (scroller === null) return clientY + window.scrollY
  return clientY - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/** The extent of a unit's rows, first top to last bottom, in list coordinates. */
export function unitExtent(elements: readonly HTMLElement[], scroller: Scroller): Extent {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    const box = element.getBoundingClientRect()
    top = Math.min(top, listY(scroller, box.top))
    bottom = Math.max(bottom, listY(scroller, box.bottom))
  }
  return top === Number.POSITIVE_INFINITY ? { top: 0, height: 0 } : { top, height: bottom - top }
}

/** Where the scroller's sticky header ends (client y): a `thead` that sticks, or whose cells do —
 *  settings.css's and categories.css's `thead th { position: sticky; top: 0 }` — or null when it has
 *  none (the page never does). Measured on what sticks: when only the CELLS stick, the row group's
 *  own box never moves, so the thead's rect would still say where the header began, scrolled away
 *  above the box (lane R7, from lane V's finding 2). */
export function stickyHeaderBottom(scroller: Scroller): number | null {
  const head = scroller?.querySelector('thead') ?? null
  if (head === null) return null
  let bottom: number | null = null
  for (const element of [head, ...head.querySelectorAll('th, td')]) {
    if (getComputedStyle(element).position !== 'sticky') continue
    const edge = element.getBoundingClientRect().bottom
    bottom = bottom === null ? edge : Math.max(bottom, edge)
  }
  return bottom
}

/** How far the scroller's sticky header reaches into its box, px: the top of its own view that the
 *  header hides. 0 for the page and for a box without one. */
export function stickyInset(scroller: Scroller): number {
  const header = stickyHeaderBottom(scroller)
  if (scroller === null || header === null) return 0
  return Math.max(0, header - scroller.getBoundingClientRect().top)
}

/** The client-y band the reader can currently see of the scroller (the viewport for the page): an
 *  element's box below its sticky header, clipped to the viewport. So the auto-scroll zone starts
 *  where the rows show — a 46px two-line header no longer hides the range's first row at the stop
 *  (lane V's finding 2) — and a 420px Settings scroller hanging past the bottom of the window keeps
 *  its zone where the pointer can reach it. */
export function visibleBounds(scroller: Scroller): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  const header = stickyHeaderBottom(scroller) ?? box.top
  return { top: Math.max(box.top, header, 0), bottom: Math.min(box.bottom, window.innerHeight) }
}

/** What the scroller shows, in list coordinates: its scroll offset and its visible height (the
 *  page's scrollY and viewport). */
export function scrollView(scroller: Scroller): { top: number; height: number } {
  return scroller === null
    ? { top: window.scrollY, height: window.innerHeight }
    : { top: scroller.scrollTop, height: scroller.clientHeight }
}

export function scrollByY(scroller: Scroller, dy: number): void {
  if (scroller === null) window.scrollBy(0, dy)
  else scroller.scrollTop += dy
}

/** Scroll the least amount that shows [top, top + height) (list coordinates) clear of the
 *  auto-scroll zone at either edge — the keyboard path's "keep the lifted row in view". The top zone
 *  starts below the scroller's sticky header, as the pointer's does (visibleBounds). */
export function ensureVisible(
  scroller: Scroller,
  top: number,
  height: number,
  margin = AUTO_SCROLL_EDGE,
): void {
  const view = scrollView(scroller)
  const first = view.top + stickyInset(scroller) + margin
  if (top < first) scrollByY(scroller, top - first)
  else if (top + height > view.top + view.height - margin) {
    scrollByY(scroller, top + height - (view.top + view.height - margin))
  }
}

/** The window scroll that brings a unit spanning [top, bottom] (client y) inside
 *  [margin, viewportHeight − margin]: 0 when it already sits there, otherwise the least signed scroll.
 *  A unit taller than that band shows its top. */
export function viewportDelta(
  top: number,
  bottom: number,
  viewportHeight: number,
  margin = AUTO_SCROLL_EDGE,
): number {
  const bandTop = margin
  const bandBottom = viewportHeight - margin
  if (bottom - top > bandBottom - bandTop || top < bandTop) return top - bandTop
  if (bottom > bandBottom) return bottom - bandBottom
  return 0
}

/** The keyboard path's second keep-in-view (spec §2.4): ensureVisible keeps [top, top + height)
 *  (list coordinates) in an element scroller's own view, but the scroller itself can hang past the
 *  window edge (a 420px Settings box low on the page), so the page scrolls too. Computed from list
 *  coordinates — the inverse of listY — never measured: a keyboard-lifted unit is mid-transition
 *  when this runs, and a painted rect would still show where it came from. It needs no header
 *  inset: the header rides in the box, and a page scroll moves both alike, so the unit stays the
 *  margin clear of it that ensureVisible left. */
export function keepOnScreen(scroller: Scroller, top: number, height: number): void {
  if (scroller === null) return
  const clientTop = top - scroller.scrollTop + scroller.getBoundingClientRect().top
  const delta = viewportDelta(clientTop, clientTop + height, window.innerHeight)
  if (delta !== 0) window.scrollBy(0, delta)
}

/** The reduced-motion drop line's thickness, px (reorder.css draws it; placeDropLine centres it). */
export const DROP_LINE_PX = 2

/** Reduced motion's landing cue (spec §2.5 as amended by lane R7): ONE overlay per drag, appended to
 *  <body> and fixed above the page's layers (reorder.css), so the row in hand — which follows the
 *  pointer across its target — can never cover it (lane V's finding 1). Hidden until placed. */
export function createDropLine(): HTMLElement {
  const line = document.createElement('div')
  line.className = 'reorder-drop-line'
  line.setAttribute('aria-hidden', 'true')
  line.hidden = true
  document.body.append(line)
  return line
}

/** The x-extent the reader can see of `box` (the client rect of `element`): clipped by every
 *  ancestor that actually scrolls sideways — a ledger wider than its .holdings-scroll — and by the
 *  window. A box with nothing to scroll clips nothing: the row fits inside it. */
export function visibleSpan(element: Element, box: DOMRect): { left: number; right: number } {
  let left = Math.max(box.left, 0)
  let right = Math.min(box.right, window.innerWidth)
  let node = element.parentElement
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowX = getComputedStyle(node).overflowX
    const clips = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'clip'
    if (clips && node.scrollWidth - node.clientWidth > 1) {
      const inner = node.getBoundingClientRect().left + node.clientLeft
      left = Math.max(left, inner)
      right = Math.min(right, inner + node.clientWidth)
    }
    node = node.parentElement
  }
  return { left, right }
}

/** Put the drop line on `edge`'s top ('before') or bottom ('after') as the row stands NOW — centred
 *  on that edge, as wide as the row shows — or hide it while that edge is outside the band the reader
 *  can see of the scroller (below its sticky header, inside the window). An edge within half the
 *  line of the band still draws: half of it shows. Positions are measured, so every paint and every
 *  scroll places it again. */
export function placeDropLine(
  line: HTMLElement,
  edge: Element,
  side: 'before' | 'after',
  scroller: Scroller,
): void {
  const box = edge.getBoundingClientRect()
  const y = side === 'before' ? box.top : box.bottom
  const band = visibleBounds(scroller)
  const span = visibleSpan(edge, box)
  const half = DROP_LINE_PX / 2
  line.hidden = y < band.top - half || y > band.bottom + half || span.right <= span.left
  if (line.hidden) return
  line.style.top = `${y - half}px`
  line.style.left = `${span.left}px`
  line.style.width = `${span.right - span.left}px`
}

/** requestAnimationFrame when the environment has it (jsdom may not), a 16ms timer otherwise. */
export function nextFrame(callback: () => void): number {
  return typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(() => callback())
    : window.setTimeout(callback, 16)
}

export function cancelFrame(id: number): void {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id)
  else window.clearTimeout(id)
}
