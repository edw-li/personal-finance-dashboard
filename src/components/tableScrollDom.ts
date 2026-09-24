import { useEffect, type RefObject } from 'react'

/**
 * The heights of a capped table's pinned rows (2026-09-24 table-scroll spec §2.4), written on the
 * box as `--table-head-h` and `--table-foot-h` (px; `0px` for a table with no thead or tfoot).
 * TableScroll's scroll padding reads them — a Tab, a keyboard reorder or a scrollIntoView lands a
 * row clear of the pinned rows — and so do the dividend month lines, which pin just under the
 * column header. Re-measured by a ResizeObserver on the TABLE: a header that wraps, a density
 * switch or a tfoot that arrives with the data all change the table's size, while the capped box's
 * own size does not. Read off getBoundingClientRect rather than offsetHeight: a 30.4px header
 * rounded to 30 would let a month line slide 0.4px under it. Without ResizeObserver (jsdom), it
 * measures once.
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
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(table)
    return () => {
      observer?.disconnect()
      box.style.removeProperty('--table-head-h')
      box.style.removeProperty('--table-foot-h')
    }
    // `ref` only for the lint rule: TableScroll's table lives as long as its box (the contract).
  }, [ref])
}

/**
 * Scroll `box` — never the page — just far enough that `row` shows inside the band the box's
 * pinned lines leave (spec §4.5): below the sticky header (`--table-head-h`) plus `extraTop` (a
 * pinned group line, such as a dividend month), and above the pinned footer (`--table-foot-h`). A
 * row already inside the band stays put; a row taller than the band is aligned by its top. Returns
 * whether it scrolled. Not scrollIntoView: that scrolls every scrollable ancestor too — the page
 * among them — which would carry the entry form, and the caret in it, out of view mid-session.
 */
export function revealInBox(box: HTMLElement, row: HTMLElement, extraTop = 0): boolean {
  const view = box.getBoundingClientRect()
  const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
  const foot = parseFloat(box.style.getPropertyValue('--table-foot-h')) || 0
  // clientTop + clientHeight, not the rect's bottom: a sideways scrollbar sits inside the rect.
  const top = view.top + box.clientTop + head + extraTop
  const bottom = view.top + box.clientTop + box.clientHeight - foot
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
