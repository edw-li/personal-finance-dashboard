import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { CalendarEvent } from '../../types/api'
import { formatDate } from '../../utils/format'
import '../assistant/assistant.css'
import { SOURCE_COLORS, chipAmount } from './calendarView'
import { cashLine, summarize } from './cashflow'

export interface DayDrawerProps {
  day: string
  /** That day's VISIBLE events in cell order (the page sorts them). */
  events: CalendarEvent[]
  onClose: () => void
  onAddOnDay: (day: string) => void
  renderDetails: (event: CalendarEvent) => ReactNode
}

// The "+N more" / day-number surface (spec §7): the assistant drawer's shell, the date, a
// cash line, every event as a row expanding to EventDetails, "Add event on {date}" at the
// bottom. Escape closes; the PAGE returns focus to the grid cell.
export default function DayDrawer({
  day,
  events,
  onClose,
  onAddOnDay,
  renderDetails,
}: DayDrawerProps) {
  const [open, setOpen] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // A drawer that opens without focus would leave the reader's caret back on the grid, so
  // Escape and Tab would both act on the page behind it. DOM call, no setState.
  useEffect(() => {
    headingRef.current?.focus()
  }, [day])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return
    // The page's own document-level Escape (the grid popover's) must not also fire.
    e.stopPropagation()
    onClose()
  }

  return (
    <aside
      className="assistant-drawer cal-drawer"
      role="dialog"
      aria-label={`${formatDate(day)} — ${events.length} ${
        events.length === 1 ? 'event' : 'events'
      }`}
      onKeyDown={onKeyDown}
    >
      <div className="assistant-header">
        <h2 ref={headingRef} tabIndex={-1} className="assistant-title cal-drawer-title">
          {formatDate(day)}
        </h2>
        <button
          type="button"
          className="assistant-icon-button"
          aria-label="Close the day"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="cal-drawer-cash">{cashLine(summarize(events))}</p>
      <div className="cal-drawer-rows">
        {events.length === 0 && <p className="empty-note">Nothing on this day.</p>}
        {events.map((event) => {
          const isOpen = open === event.key
          return (
            <div key={event.key} className="cal-drawer-item">
              <button
                type="button"
                className={`cal-drawer-row${event.done ? ' is-done' : ''}`}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : event.key)}
              >
                <span
                  className="cal-drawer-bar"
                  aria-hidden="true"
                  style={{ backgroundColor: SOURCE_COLORS[event.source] }}
                />
                <span className="cal-drawer-label">{event.label}</span>
                <span className="cal-drawer-amount num">{chipAmount(event) ?? '—'}</span>
                {event.basis === 'estimated' && event.amount !== null && (
                  <span className="badge">est.</span>
                )}
              </button>
              {isOpen && <div className="cal-drawer-expansion">{renderDetails(event)}</div>}
            </div>
          )
        })}
      </div>
      <div className="cal-drawer-footer">
        <button type="button" className="button" onClick={() => onAddOnDay(day)}>
          Add event on {formatDate(day)}
        </button>
      </div>
    </aside>
  )
}
