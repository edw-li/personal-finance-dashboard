import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { CalendarEvent } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { addDays, addMonths, isoWeekday, monthGrid } from '../../utils/months'
import {
  CHIP_CAP,
  SOURCE_COLORS,
  chipText,
  chipTitle,
  groupByDate,
  sortForCell,
} from './calendarView'
import { signedCompact, weekSummary } from './cashflow'
import type { CashSummary } from './cashflow'

// The month grid as a real ARIA grid (2026-09-03 calendar spec §8): rows of gridcells, one
// tab stop (the active day) with a roving tabindex, arrows ±1/±7, Home/End across the week,
// PageUp/PageDown across months, Enter/Space opening the day drawer. Chips are buttons in
// the active cell's tab order only. Every row ends with a week-totals gutter. The grid owns
// no data: events, the active day, the open popover key and every verb come from the page.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface CalendarGridProps {
  /** First-of-month ISO date. */
  month: string
  /** VISIBLE events for the fetched window (hidden already removed by the page). */
  events: CalendarEvent[]
  today: string
  activeDay: string
  /** Bump to pull focus back to the active cell (the drawer's Escape does). */
  focusTick: number
  /** The event whose anchored popover is open, by key. */
  openKey: string | null
  popoverRef: RefObject<HTMLDivElement | null>
  renderDetails: (event: CalendarEvent) => ReactNode
  onActiveDay: (day: string) => void
  onOpenDay: (day: string) => void
  onToggleEvent: (event: CalendarEvent, anchor: HTMLElement) => void
  onMonthStep: (delta: 1 | -1) => void
}

/** The same day of month one month over, clamped to that month's last day. */
export function shiftMonth(dayIso: string, delta: number): string {
  const target = addMonths(`${dayIso.slice(0, 7)}-01`, delta)
  const lastDay = Number(addDays(addMonths(target, 1), -1).slice(8, 10))
  const day = Math.min(Number(dayIso.slice(8, 10)), lastDay)
  return `${target.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

/** "+$6.8k / −$395" for the week gutter; an em dash when nothing moves. */
export function gutterText(summary: CashSummary): string {
  if (summary.cashIn === 0 && summary.cashOut === 0) return '—'
  return `${signedCompact(summary.cashIn, 'in', summary.estimated.cashIn)} / ${signedCompact(
    summary.cashOut,
    'out',
    summary.estimated.cashOut,
  )}`
}

export default function CalendarGrid({
  month,
  events,
  today,
  activeDay,
  focusTick,
  openKey,
  popoverRef,
  renderDetails,
  onActiveDay,
  onOpenDay,
  onToggleEvent,
  onMonthStep,
}: CalendarGridProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>())
  // Focus follows the active day only after a KEYBOARD move or an explicit tick — a mouse
  // click on a cell already carries focus, and the initial render must not steal it.
  const pendingFocus = useRef(false)
  const seenTick = useRef(focusTick)
  useEffect(() => {
    if (pendingFocus.current || seenTick.current !== focusTick) {
      pendingFocus.current = false
      seenTick.current = focusTick
      cellRefs.current.get(activeDay)?.focus()
    }
  })

  const weeks = monthGrid(month)
  const byDate = groupByDate(events)
  const shownMonth = month.slice(0, 7)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    let next: string | null = null
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(activeDay, -1)
        break
      case 'ArrowRight':
        next = addDays(activeDay, 1)
        break
      case 'ArrowUp':
        next = addDays(activeDay, -7)
        break
      case 'ArrowDown':
        next = addDays(activeDay, 7)
        break
      case 'Home':
        next = addDays(activeDay, -isoWeekday(activeDay))
        break
      case 'End':
        next = addDays(activeDay, 6 - isoWeekday(activeDay))
        break
      case 'PageUp':
        next = shiftMonth(activeDay, -1)
        break
      case 'PageDown':
        next = shiftMonth(activeDay, 1)
        break
      case 'Enter':
      case ' ':
        // Only the CELL opens the drawer — a chip or button handles its own Enter.
        if (target.getAttribute('role') === 'gridcell') {
          e.preventDefault()
          onOpenDay(activeDay)
        }
        return
      default:
        return
    }
    e.preventDefault()
    pendingFocus.current = true
    if (next.slice(0, 7) !== shownMonth) onMonthStep(next > activeDay ? 1 : -1)
    onActiveDay(next)
  }

  return (
    <div
      className="cal-grid"
      role="grid"
      aria-label={`${formatMonth(month)} calendar`}
      onKeyDown={onKeyDown}
    >
      <div role="row" className="cal-grid-row">
        {DOW.map((dow) => (
          <div key={dow} role="columnheader" className="cal-dow">
            {dow}
          </div>
        ))}
        <div role="columnheader" className="cal-dow cal-gutter-head">
          Week
        </div>
      </div>
      {weeks.map((week) => (
        <div role="row" className="cal-grid-row" key={week[0]}>
          {week.map((day, dayIndex) => {
            const outside = day.slice(0, 7) !== shownMonth
            const active = day === activeDay
            const sorted = sortForCell(byDate.get(day) ?? [])
            // Three slots: all three chips, or two chips and the overflow button (spec §7).
            const overflow = sorted.length > CHIP_CAP ? sorted.length - (CHIP_CAP - 1) : 0
            const shown = overflow > 0 ? sorted.slice(0, CHIP_CAP - 1) : sorted
            const tab = active ? 0 : -1
            return (
              <div
                key={day}
                role="gridcell"
                data-day={day}
                aria-selected={active}
                aria-label={`${formatDate(day)}, ${sorted.length} ${
                  sorted.length === 1 ? 'event' : 'events'
                }`}
                tabIndex={tab}
                ref={(el) => {
                  if (el) cellRefs.current.set(day, el)
                  else cellRefs.current.delete(day)
                }}
                className={`cal-day${outside ? ' cal-day-outside' : ''}${
                  day === today ? ' cal-day-today' : ''
                }${active ? ' cal-day-active' : ''}`}
                onClick={() => onActiveDay(day)}
              >
                <button
                  type="button"
                  className="cal-day-number"
                  tabIndex={tab}
                  aria-label={`Open ${formatDate(day)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDay(day)
                  }}
                >
                  {Number(day.slice(8, 10))}
                </button>
                {shown.map((event) => {
                  const isOpen = openKey === event.key
                  return (
                    <div key={event.key} className="cal-chip-slot">
                      <button
                        type="button"
                        className={`cal-chip${event.done ? ' is-done' : ''}`}
                        tabIndex={tab}
                        aria-expanded={isOpen}
                        aria-haspopup="dialog"
                        title={chipTitle(event)}
                        style={{ borderLeftColor: SOURCE_COLORS[event.source] }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleEvent(event, e.currentTarget)
                        }}
                      >
                        {chipText(event)}
                      </button>
                      {isOpen && (
                        <div
                          ref={popoverRef}
                          role="dialog"
                          aria-label={event.label}
                          tabIndex={-1}
                          className={`cal-popover${dayIndex >= 5 ? ' cal-popover-right' : ''}`}
                        >
                          {renderDetails(event)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="cal-more"
                    tabIndex={tab}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenDay(day)
                    }}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            )
          })}
          <div role="gridcell" className="cal-gutter" aria-label="Week totals" tabIndex={-1}>
            {gutterText(weekSummary(events, week))}
          </div>
        </div>
      ))}
    </div>
  )
}
