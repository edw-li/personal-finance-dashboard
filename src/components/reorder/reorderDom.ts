// Drag to reorder — the DOM half (2026-09-23 spec §2.3). The hook measures rows once at lift and
// then reasons in LIST coordinates (px from the top of the scroll container's content), so an
// auto-scroll in the middle of a drag never invalidates a measurement: only the pointer is
// re-converted, on every move and every scroll.
import { AUTO_SCROLL_EDGE } from './reorderMath'
import type { Extent } from './reorderMath'

/** The element that scrolls the list, or null for the page. */
export type Scroller = HTMLElement | null

/** The nearest ancestor that actually scrolls vertically — the Settings tables' 420px
 *  `.settings-scroll`, a capped TableScroll box (the transactions ledger's) — or null when the page
 *  does. More than 1px of overhang: a box with only `overflow-x: auto` (a bare `.holdings-scroll`,
 *  AllocationTargetEditor's) computes `overflow-y: auto` too, and display scaling can round its
 *  content 1px taller than its box — that box must not steal the page's auto-scroll. Nor does a
 *  TableScroll box whose table fits under its cap: it has nothing to scroll, so the page keeps it. */
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

/** What a drag knows of where its list stands — useReorder's Drag carries all three: the scroller,
 *  and, resolved ONCE at lift so no frame or pointer move reads a computed style or walks the
 *  ancestors again (lane R7 review 7), what sticks of its header and what clips it sideways. Only
 *  their rects are read after. */
export interface ListFrame {
  scroller: Scroller
  /** stickyHeaderOf: empty without one. */
  header: readonly Element[]
  /** sideClipsOf: empty when nothing clips. */
  clips: readonly HTMLElement[]
}

/** What sticks of `row`'s OWN table header inside the scroller — the thead itself, or its cells
 *  (settings.css's and categories.css's `thead th { position: sticky; top: 0 }`) — or nothing: the
 *  page never has one, and a header outside the box (a table whose body scrolls) stands above it
 *  rather than over its rows. Never the box's first thead, which may be another table's. */
export function stickyHeaderOf(row: Element | null, scroller: Scroller): Element[] {
  const head = row?.closest('table')?.tHead ?? null
  if (head === null || scroller === null || !scroller.contains(head)) return []
  return [head, ...head.querySelectorAll('th, td')].filter(
    (element) => getComputedStyle(element).position === 'sticky',
  )
}

/** Where a sticky header (stickyHeaderOf) ends NOW, client y, measured on what sticks: when only the
 *  CELLS stick, the row group's own box never moves, so the thead's rect would still say where the
 *  header began, scrolled away above the box (lane R7, from lane V's finding 2). Null without one. */
export function headerBottom(header: readonly Element[]): number | null {
  let bottom: number | null = null
  for (const element of header) {
    const edge = element.getBoundingClientRect().bottom
    bottom = bottom === null ? edge : Math.max(bottom, edge)
  }
  return bottom
}

/** How far a sticky header reaches into its scroller's box, px: the top of the scroller's own view
 *  that the header hides. 0 for the page and without one. */
export function stickyInset(scroller: Scroller, header: readonly Element[]): number {
  const bottom = headerBottom(header)
  if (scroller === null || bottom === null) return 0
  return Math.max(0, bottom - scroller.getBoundingClientRect().top)
}

/** The client-y band the reader can currently see of the scroller (the viewport for the page): an
 *  element's box below its sticky `header` (stickyHeaderOf), clipped to the viewport. So the
 *  auto-scroll zone starts where the rows show — a 46px two-line header no longer hides the range's
 *  first row at the stop (lane V's finding 2) — and a 420px Settings scroller hanging past the bottom
 *  of the window keeps its zone where the pointer can reach it. */
export function visibleBounds(
  scroller: Scroller,
  header: readonly Element[] = [],
): { top: number; bottom: number } {
  if (scroller === null) return { top: 0, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  const top = headerBottom(header) ?? box.top
  return { top: Math.max(box.top, top, 0), bottom: Math.min(box.bottom, window.innerHeight) }
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
 *  starts below the scroller's sticky `header` (stickyHeaderOf), as the pointer's does. */
export function ensureVisible(
  scroller: Scroller,
  top: number,
  height: number,
  header: readonly Element[] = [],
  margin = AUTO_SCROLL_EDGE,
): void {
  const view = scrollView(scroller)
  const first = view.top + stickyInset(scroller, header) + margin
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

/** One frame of the pointer's auto-scroll (spec §2.3), and the pointer path's twin of keepOnScreen:
 *  `dy` scrolls the scroller — and, once a box stands at its own end, the PAGE, while that box still
 *  hangs past the window on the side the drag is heading. The zone's band is clipped to the window
 *  (visibleBounds), so a spent box still hides what lies beyond the window's edge, where no pointer
 *  can follow: the capped transactions ledger (TableScroll, 60vh tall from y≈467) hangs 147px below
 *  a 1280×800 window on arrival, 67px below a 1600×1000 one, and its last 1–3 slots were out of reach
 *  — the drop landed short, in a replay order that drives cost basis (table-scroll Task 4 review).
 *  The window's edges are visibleBounds' own, 0 and innerHeight, so the page stops as soon as the
 *  box's edge is inside the window: the pointer reaches its end from there. Each page scroll
 *  re-tracks the row in hand through useReorder's window scroll listener. */
export function autoScrollBy(scroller: Scroller, dy: number): void {
  if (scroller === null) {
    window.scrollBy(0, dy)
    return
  }
  const before = scroller.scrollTop
  scroller.scrollTop += dy
  // The box moved, so it had room: by more than half a pixel — display scaling can park a box on a
  // device pixel a hair short of a fractional end, and that last hair is no room — or, for a
  // sub-pixel step at the zone's inner edge, by more than half the step.
  if (Math.abs(scroller.scrollTop - before) > Math.min(0.5, Math.abs(dy) / 2)) return
  const box = scroller.getBoundingClientRect()
  if (dy > 0 ? box.bottom > window.innerHeight : box.top < 0) window.scrollBy(0, dy)
}

/** The reduced-motion drop line's thickness, px (reorder.css draws it; placeDropLine centres it). */
export const DROP_LINE_PX = 2

/** The lifted row's z-index — reorder.css's `[data-reorder='lifted']`, pinned there. */
export const LIFTED_LAYER = 2

/** The drop line's z-index: one above its list's own layer, so nothing in that layer covers it — not
 *  the row in hand (LIFTED_LAYER), not a sticky header (1) — while whatever covers the list covers the
 *  line too. That layer is the highest z-index among the list's positioned ancestors: `.page` is NOT a
 *  stacking context (its container query applies no layout containment in Edge — measured at lane R7,
 *  whatever panels.css says), so the page's layers all stack in the root, and a list inside the
 *  Customize popover (z-index 20) needs 21. One fixed number that high would lift every other list's
 *  line over the sticky scope row (8), the assistant drawer (15) and the dock (16).
 *
 *  ASSUMED: `.page` is not a stacking context — and this cannot see one made without a z-index
 *  (below). Were `.page` made one (`isolation: isolate`, `contain`, a transform …), the whole page,
 *  PageFrame's sticky scope row included, would paint as ONE root layer beneath this line on <body>,
 *  which would then cover the scope row and the bubbles — and from 21 up the drawer and the dock. Such
 *  a change must move the line inside `.page` with it (R7 review 1).
 *
 *  A heuristic, with limits — it reads z-indexes on POSITIONED ancestors only, so it cannot see:
 *  - a flex or grid item's z-index, which makes a layer without any positioning;
 *  - a stacking context made WITHOUT a z-index — opacity below 1, a transform, a filter,
 *    `isolation: isolate`, containment, a mask. Such a context paints its whole subtree as ONE layer
 *    at its own level, which this reads as if each z-index inside it stacked in the root.
 *  None of those stands between a reorderable list and the root today (R7 review 3). */
export function dropLineLayer(element: Element): number {
  let layer = LIFTED_LAYER
  let node = element.parentElement
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    const z = Number.parseInt(style.zIndex, 10)
    // Positioned boxes only — jsdom leaves an unset position '' where a browser says 'static'. A flex
    // or grid item's z-index makes a layer too; it is one of this heuristic's limits (above).
    const positioned = style.position !== '' && style.position !== 'static'
    if (positioned && Number.isFinite(z)) layer = Math.max(layer, z)
    node = node.parentElement
  }
  return layer + 1
}

/** Reduced motion's landing cue (spec §2.5 as amended by lane R7): ONE overlay per drag, appended to
 *  <body>, fixed, one layer above the list whose `row` it marks (dropLineLayer), so the row in hand —
 *  which follows the pointer across its target — can never cover it (lane V's finding 1). Hidden
 *  until placed. */
export function createDropLine(row: Element): HTMLElement {
  const line = document.createElement('div')
  line.className = 'reorder-drop-line'
  line.setAttribute('aria-hidden', 'true')
  line.hidden = true
  line.style.zIndex = String(dropLineLayer(row))
  document.body.append(line)
  return line
}

/** The ancestors of `element` that clip it sideways AND actually overflow — a ledger wider than its
 *  .holdings-scroll. A box with nothing to scroll clips nothing: the row fits inside it. */
export function sideClipsOf(element: Element | null): HTMLElement[] {
  const clips: HTMLElement[] = []
  let node = element?.parentElement ?? null
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowX = getComputedStyle(node).overflowX
    const clipping =
      overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'clip'
    if (clipping && node.scrollWidth - node.clientWidth > 1) clips.push(node)
    node = node.parentElement
  }
  return clips
}

/** The x-extent the reader can see of a row's client rect `box`: clipped by the inner box of each
 *  of its `clips` (sideClipsOf) where they stand now, and by the window. */
export function visibleSpan(
  box: DOMRect,
  clips: readonly HTMLElement[],
): { left: number; right: number } {
  let left = Math.max(box.left, 0)
  let right = Math.min(box.right, window.innerWidth)
  for (const clip of clips) {
    const inner = clip.getBoundingClientRect().left + clip.clientLeft
    left = Math.max(left, inner)
    right = Math.min(right, inner + clip.clientWidth)
  }
  return { left, right }
}

/** Put the drop line on `edge`'s top ('before') or bottom ('after') as the row stands NOW — centred
 *  on that edge, as wide as the row shows — or hide it while that edge is outside the band the reader
 *  can see of the scroller (below its sticky header, inside the window). An edge within half the
 *  line of the band still draws: half of it shows. Positions are measured, so every paint and every
 *  scroll places it again — from the drag's `frame`, resolved at lift, reading rects alone. */
export function placeDropLine(
  line: HTMLElement,
  edge: Element,
  side: 'before' | 'after',
  frame: ListFrame,
): void {
  const box = edge.getBoundingClientRect()
  const y = side === 'before' ? box.top : box.bottom
  const band = visibleBounds(frame.scroller, frame.header)
  const span = visibleSpan(box, frame.clips)
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
