// Drag to reorder — the DOM half (2026-09-23 spec §2.3). The hook measures rows once at lift and
// then reasons in LIST coordinates (px from the top of the scroll container's content), so an
// auto-scroll in the middle of a drag never invalidates a measurement: only the pointer is
// re-converted, on every move and every scroll.
import { AUTO_SCROLL_EDGE } from './reorderMath'
import type { Extent } from './reorderMath'

/** The element that scrolls the list, or null for the page. */
export type Scroller = HTMLElement | null

/** The nearest ancestor that actually scrolls vertically (the Settings tables' 420px
 *  `.settings-scroll`), or null when the page does. */
export function scrollParentOf(element: Element | null | undefined): Scroller {
  let node = element?.parentElement ?? null
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
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

/** The client-y band the reader can currently see of the scroller (the viewport for the page). */
export function visibleBounds(scroller: Scroller): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom }
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
  const viewTop = scroller === null ? window.scrollY : scroller.scrollTop
  const viewHeight = scroller === null ? window.innerHeight : scroller.clientHeight
  if (top < viewTop + margin) scrollByY(scroller, top - (viewTop + margin))
  else if (top + height > viewTop + viewHeight - margin) {
    scrollByY(scroller, top + height - (viewTop + viewHeight - margin))
  }
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
