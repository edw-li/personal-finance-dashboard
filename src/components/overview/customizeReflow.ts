import type { OverviewCard } from '../../prefs/overviewLayout'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { prefersReducedMotion } from '../useReducedMotion'

/** The deeper views drawn half-width (2026-09-25 polish spec §3.2): the two chart cards that read as
 *  a pair. Every other deeper view runs the full row. */
export const HALF_WIDTH_CARDS: ReadonlySet<OverviewCard> = new Set<OverviewCard>(['performance', 'spending'])

/**
 * Each deeper view's span, from the order the reader chose in Customize (spec §3.2, OU-16): two
 * adjacent half-width views pair, 6 + 6, and a half-width view whose neighbour is not half-width runs
 * the full row — so hiding or reordering never strands a chart beside a ~567px hole. `shown` is the
 * render order with the views that draw nothing already left out: an empty Year to date between the
 * two charts must not keep them apart. Pairs are taken left to right.
 */
export function deeperSpans(shown: readonly OverviewCard[]): Map<OverviewCard, 6 | 12> {
  const spans = new Map<OverviewCard, 6 | 12>()
  for (let index = 0; index < shown.length; index += 1) {
    const id = shown[index]
    const next = shown[index + 1]
    if (HALF_WIDTH_CARDS.has(id) && next !== undefined && HALF_WIDTH_CARDS.has(next)) {
      spans.set(id, 6)
      spans.set(next, 6)
      index += 1
    } else {
      spans.set(id, 12)
    }
  }
  return spans
}

/** The id every glide and fade here carries, so a later change can find — and cancel — its own. */
export const FLIP_ANIMATION_ID = 'customize-reflow'

/** Each child's box, keyed by the view it draws: `ids` is the render order, one child per id. The
 *  box is read as it is on screen — mid-glide if one is running — which is where a new glide starts. */
export function childRects(container: Element | null, ids: readonly string[]): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  if (container === null) return rects
  ids.forEach((id, index) => {
    const child = container.children[index]
    if (child !== undefined) rects.set(id, child.getBoundingClientRect())
  })
  return rects
}

/**
 * The Customize reflow's short FLIP (spec §3.2, OU-16): each child that moved glides from where it
 * was, and one that was not there before fades in — --t-fast on the house curve, so the page
 * rearranging behind the popover reads as the same cards moving, not cards popping in and out. WAAPI
 * (the LocalSectionPanel idiom) on `translate`, so a card's scroll-linked reveal, which rides
 * `transform`, composes with it. Widths snap: a span change is not a move. The sideways travel is
 * clamped to the container: a card that grew (a half-width chart now running the full row) would start
 * hanging past the grid's side, and the page flashed a horizontal scrollbar for the length of the
 * glide. A glide of this module's own still running when the next change lands (two clicks inside
 * 120ms) is cancelled before the child's new box is read: its translate would offset that read and the
 * new glide jumped. Nothing under reduced motion, or where animate() is missing (jsdom).
 */
export function flipChildren(container: Element | null, ids: readonly string[], before: ReadonlyMap<string, DOMRect>): void {
  if (container === null || prefersReducedMotion()) return
  const bounds = container.getBoundingClientRect()
  ids.forEach((id, index) => {
    const child = container.children[index] as HTMLElement | undefined
    if (child === undefined || typeof child.animate !== 'function') return
    if (typeof child.getAnimations === 'function') {
      for (const running of child.getAnimations()) if (running.id === FLIP_ANIMATION_ID) running.cancel()
    }
    const was = before.get(id)
    if (was === undefined) {
      child.animate([{ opacity: 0 }, { opacity: 1 }], { id: FLIP_ANIMATION_ID, duration: MOTION_MS.fast, easing: EASE_OUT })
      return
    }
    const now = child.getBoundingClientRect()
    const dx = Math.min(Math.max(Math.round(was.left - now.left), Math.ceil(bounds.left - now.left)), Math.floor(bounds.right - now.right))
    const dy = Math.round(was.top - now.top)
    if (dx === 0 && dy === 0) return
    child.animate([{ translate: `${dx}px ${dy}px` }, { translate: 'none' }], { id: FLIP_ANIMATION_ID, duration: MOTION_MS.fast, easing: EASE_OUT })
  })
}
