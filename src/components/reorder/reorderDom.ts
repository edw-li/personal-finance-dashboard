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

/** The client-y band the reader can currently see of the scroller (the viewport for the page). An
 *  element's box is clipped to the viewport: a 420px Settings scroller hanging past the bottom of the
 *  window keeps its auto-scroll zone where the pointer can reach it. */
export function visibleBounds(scroller: Scroller): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  return { top: Math.max(box.top, 0), bottom: Math.min(box.bottom, window.innerHeight) }
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
 *  auto-scroll zone at either edge — the keyboard path's "keep the lifted row in view". */
export function ensureVisible(
  scroller: Scroller,
  top: number,
  height: number,
  margin = AUTO_SCROLL_EDGE,
): void {
  const view = scrollView(scroller)
  if (top < view.top + margin) scrollByY(scroller, top - (view.top + margin))
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
 *  when this runs, and a painted rect would still show where it came from. */
export function keepOnScreen(scroller: Scroller, top: number, height: number): void {
  if (scroller === null) return
  const clientTop = top - scroller.scrollTop + scroller.getBoundingClientRect().top
  const delta = viewportDelta(clientTop, clientTop + height, window.innerHeight)
  if (delta !== 0) window.scrollBy(0, delta)
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
