import { useEffect, type RefObject } from 'react'

/**
 * The heights of a capped table's pinned rows (2026-09-24 table-scroll spec §2.4), written on the
 * box as `--table-head-h` and `--table-foot-h` (px; `0px` for a table with no thead or tfoot), and
 * the width of the box's own vertical scrollbar as `--table-scrollbar-w` (px; `0px` with none, or
 * with overlay scrollbars, which take no room). TableScroll's row scroll margin reads the heights —
 * a Tab, a keyboard reorder or a scrollIntoView lands a row clear of the pinned rows — and so do the
 * dividend month lines, which pin just under the column header; tableScroll.css's right-edge fade
 * reads the width, to stop short of the classic scrollbar it would otherwise fade (Task 5 review).
 * Re-measured by a ResizeObserver on the TABLE — a header that wraps, a density switch or a tfoot
 * that arrives with the data all change the table's size, while the capped box's own size does not
 * — and on the BOX: a shorter window lowers the cap under a table wider than the box, and the
 * scrollbar that appears leaves the table's size untouched (measured in Edge: the table's observer
 * never fired, the box's did). The heights are read off getBoundingClientRect rather than
 * offsetHeight: a 30.4px header rounded to 30 would let a month line slide 0.4px under it. A
 * transform is the one change they cannot see: getBoundingClientRect reports transformed heights,
 * and a ResizeObserver does not fire on a transform — every entrance above these tables is
 * translate-only today (card-enter, reveal-in, page-body-in), so a scale() entrance added later
 * would need a re-measure when it ends. Without ResizeObserver (jsdom), it measures once.
 */
export function useStickyInsets(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const table = box.querySelector<HTMLTableElement>(':scope > table')
    if (table === null) return
    const measure = () => {
      box.style.setProperty('--table-head-h', `${table.tHead?.getBoundingClientRect().height ?? 0}px`)
      box.style.setProperty('--table-foot-h', `${table.tFoot?.getBoundingClientRect().height ?? 0}px`)
      // The border-box less the client area is the scrollbar plus the side borders: the box draws no
      // border today, but the width must not depend on that. offsetWidth and clientWidth are whole
      // pixels, so a fractional border could round the difference below zero.
      const style = getComputedStyle(box)
      const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
      box.style.setProperty('--table-scrollbar-w', `${Math.max(0, box.offsetWidth - box.clientWidth - borders)}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(table)
    observer?.observe(box)
    return () => {
      observer?.disconnect()
      box.style.removeProperty('--table-head-h')
      box.style.removeProperty('--table-foot-h')
      box.style.removeProperty('--table-scrollbar-w')
    }
    // `ref` only for the lint rule: TableScroll's table lives as long as its box (the contract).
  }, [ref])
}

/**
 * Scroll `box` — never the page — just far enough that `row` shows inside the band the box's
 * pinned lines leave (spec §4.5): below the sticky header (`--table-head-h`) plus `extraTop` (a
 * pinned group line, such as a dividend month), and above the pinned footer (`--table-foot-h`) —
 * or, where the table has no footer, above the "more below" fade (`--table-fade-h`) that pins to
 * that edge instead: a row revealed flush with the foot would sit under it (Task 4 review). A row
 * already inside the band stays put; a row taller than the band is aligned by its top. Returns
 * whether it scrolled. Not scrollIntoView: that scrolls every scrollable ancestor too — the page
 * among them — which would carry the entry form, and the caret in it, out of view mid-session.
 */
export function revealInBox(box: HTMLElement, row: HTMLElement, extraTop = 0): boolean {
  const view = box.getBoundingClientRect()
  const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
  const foot = parseFloat(box.style.getPropertyValue('--table-foot-h')) || 0
  // The fade shows only where no tfoot is (tableScroll.css's same `> table > tfoot` test). Its height
  // is the sheet's, not the element's, so it is read off the COMPUTED style: '' → 0 without the sheet.
  const fade =
    box.querySelector(':scope > table > tfoot') === null
      ? parseFloat(getComputedStyle(box).getPropertyValue('--table-fade-h')) || 0
      : 0
  // clientTop + clientHeight, not the rect's bottom: a sideways scrollbar sits inside the rect.
  const top = view.top + box.clientTop + head + extraTop
  const bottom = view.top + box.clientTop + box.clientHeight - foot - fade
  const r = row.getBoundingClientRect()
  if (r.top < top) {
    box.scrollTop -= top - r.top
    return true
  }
  if (r.bottom > bottom) {
    box.scrollTop += Math.min(r.bottom - bottom, r.top - top)
    return true
  }
  return false
}
