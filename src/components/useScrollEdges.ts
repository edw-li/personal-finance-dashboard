import { useEffect, type RefObject } from 'react'

// Which edges of a horizontal scroller still hide content (2026-09-13 polish §7). Written as a
// space-separated `data-scroll-more` token list ("left", "right", "left right") so panels.css can
// mask the hidden edge with [data-scroll-more~="…"]; removed outright when nothing is hidden, so
// a table that fits its card carries no attribute and no mask. Re-read on scroll, on the
// scroller's own resize (a dock opening narrows it with no window event) and on window resize.
// Page lanes attach it to their `*-scroll` wrappers alongside the `.row-actions` cells.
export function useScrollEdges(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const update = () => {
      const edges: string[] = []
      if (el.scrollLeft > 0) edges.push('left')
      // A 1px tolerance: fractional widths leave scrollLeft + clientWidth a hair short of
      // scrollWidth at the far right, which would pin a phantom "more" on a fully scrolled table.
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) edges.push('right')
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
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
      el.removeAttribute('data-scroll-more')
    }
  }, [ref])
}
