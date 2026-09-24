import { useEffect, type RefObject } from 'react'

/**
 * Which edges of a horizontal scroller still hide content (2026-09-13 polish §7). Written as a
 * space-separated `data-scroll-more` token list ("left", "right", "left right") so panels.css can
 * mask the hidden edge with [data-scroll-more~="…"]; removed outright when nothing is hidden, so
 * a table that fits its card carries no attribute and no mask. Re-read on scroll, on the
 * scroller's own resize (a dock opening narrows it with no window event) and on window resize.
 * Page lanes attach it to their `*-scroll` wrappers alongside the `.row-actions` cells.
 *
 * `axes` (2026-09-24 table-scroll spec §2.3): the default 'x' reads the sideways edges only, exactly
 * as it always has; 'xy' also names "top" and "bottom", after them, for a box capped in height
 * (TableScroll). Opt-in, so every existing caller's attribute stays byte-identical: CategoriesCard's
 * `.settings-scroll` is already capped in height and would start carrying real top/bottom tokens,
 * and an `overflow-x: auto` box computes `overflow-y: auto` and can round its content a pixel taller
 * than the box. In 'xy' the ResizeObserver also watches the box's direct-child table — looked up
 * once each time the effect runs, which TableScroll's contract (one table living as long as the
 * box) makes safe: once the box is capped its own size stops changing, so rows landing (or a
 * dividend month opening) would otherwise leave "bottom" stale until the next scroll.
 *
 * A ref is not a reactive value — it is filled during the commit, silently — so an effect that
 * finds `ref.current` null and returns has nothing to wake it when the element finally arrives.
 * Callers therefore pick one of two shapes (2026-09-13 review round: before `active` existed, a
 * hook placed above a table that renders only once rows load attached on WARM renders and never
 * on the first load, so that table was never masked):
 *
 * - call the hook INSIDE the component that renders the scroller unconditionally, so the ref is
 *   filled by the first commit; or
 * - keep it above a conditional scroller and pass `active={rows.length > 0}` — the flip re-runs
 *   the effect, by which time the element exists. `active` going false detaches and clears the
 *   attribute, which is what a scroller on its way out wants anyway.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  active = true,
  axes: 'x' | 'xy' = 'x',
): void {
  useEffect(() => {
    const el = active ? ref.current : null
    if (el === null) return
    const update = () => {
      const edges: string[] = []
      if (el.scrollLeft > 0) edges.push('left')
      // A 1px tolerance: fractional widths leave scrollLeft + clientWidth a hair short of
      // scrollWidth at the far right, which would pin a phantom "more" on a fully scrolled table.
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) edges.push('right')
      if (axes === 'xy') {
        if (el.scrollTop > 0) edges.push('top')
        // The same tolerance at the foot.
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) edges.push('bottom')
      }
      if (edges.length === 0) el.removeAttribute('data-scroll-more')
      else el.setAttribute('data-scroll-more', edges.join(' '))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    // Guarded for jsdom and old browsers (PageFrame's idiom): without it the edges refresh on
    // the next scroll or window resize instead.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    const table = axes === 'xy' ? el.querySelector(':scope > table') : null
    if (table !== null) observer?.observe(table)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
      el.removeAttribute('data-scroll-more')
    }
    // `active` is in the deps for the whole point of it: the effect has to run again when the
    // scroller appears. `axes` because a caller that switched it wants the other token set. `ref`
    // is here only because the lint rule asks for it — a ref's identity never changes, and its
    // .current is invisible to this list.
  }, [ref, active, axes])
}
