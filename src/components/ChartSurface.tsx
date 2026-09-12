import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './chartInteractions.css'

/** Move one portal container, not the React tree: expansion keeps the live ECharts
 * instance, its legend/zoom, page controls, table state, and connection group intact. */
export default function ChartSurface({ children, expanded, onClose, title, span }: {
  children: ReactNode
  expanded: boolean
  onClose: () => void
  title: string
  span: 6 | 12
}) {
  const [host] = useState(() => document.createElement('div'))
  const slot = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const origin = useRef<{ focus: HTMLElement | null; scroll: number } | null>(null)

  useLayoutEffect(() => {
    const placeholder = slot.current
    const surface = dialog.current
    if (!placeholder || !surface) return
    if (expanded) {
      origin.current = { focus: document.activeElement instanceof HTMLElement ? document.activeElement : null, scroll: window.scrollY }
      placeholder.style.height = `${host.getBoundingClientRect().height}px`
      surface.appendChild(host)
      if (typeof surface.showModal === 'function') surface.showModal()
      else surface.setAttribute('open', '')
      surface.querySelector<HTMLElement>('[data-chart-collapse]')?.focus({ preventScroll: true })
    } else {
      if (typeof surface.close === 'function') surface.close()
      else surface.removeAttribute('open')
      placeholder.appendChild(host)
      placeholder.style.height = ''
      if (origin.current) {
        origin.current.focus?.focus({ preventScroll: true })
        if (window.scrollY !== origin.current.scroll) window.scrollTo({ top: origin.current.scroll, behavior: 'instant' })
        origin.current = null
      }
    }
  }, [expanded, host])

  return <>
    <div ref={slot} className={`chart-card-slot span-${span}`} />
    {createPortal(<dialog ref={dialog} className="chart-expanded-dialog" aria-label={`${title} expanded chart`} onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose() }
    }} />, document.body)}
    {createPortal(children, host)}
  </>
}
