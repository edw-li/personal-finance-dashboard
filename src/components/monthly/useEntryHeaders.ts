import { useLayoutEffect, useRef } from 'react'

/** Keep dates and one current-section label visible below the page scope. */
export function useEntryHeaders(step: string, rows: unknown, owners: unknown) {
  const tableRef = useRef<HTMLTableElement>(null)
  const contextRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const table = tableRef.current
    if (table === null) return
    const entries = [...table.querySelectorAll<HTMLElement>('tr[data-entry-group]')]
    let frame = 0
    const updateContext = () => {
      const context = contextRef.current
      if (context === null) return
      const inset = parseFloat(getComputedStyle(table).getPropertyValue('--sticky-inset')) || 0
      const boundary = inset + (table.tHead?.offsetHeight ?? 0)
      const firstVisible = entries.find(row => row.getBoundingClientRect().bottom > boundary) ?? entries.at(-1)
      const owner = firstVisible?.closest('tbody')?.dataset.entryOwner
      // This label is a visual scroll aid; the original owner/group headings remain in the
      // accessible table. Updating the span avoids re-rendering every amount input on scroll.
      context.textContent = [owner, firstVisible?.dataset.entryGroup].filter(Boolean).join(' / ') || 'Account balances'
    }
    const measure = () => {
      table.style.setProperty('--entry-columns-height', `${table.tHead?.rows[0]?.getBoundingClientRect().height ?? 0}px`)
      table.style.setProperty('--entry-header-height', `${table.tHead?.offsetHeight ?? 0}px`)
      updateContext()
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; updateContext() })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (table.tHead) observer?.observe(table.tHead)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(frame)
    }
  }, [step, rows, owners])
  return { tableRef, contextRef }
}
