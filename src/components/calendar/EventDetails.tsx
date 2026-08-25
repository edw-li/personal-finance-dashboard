import { NavLink } from 'react-router-dom'
import type { CalendarEvent } from '../../types/api'
import { formatDate } from '../../utils/format'
import { EVENT_COLORS, EVENT_TYPE_LABELS, hrefLabel } from './calendarView'

interface Props {
  event: CalendarEvent
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  deleting: boolean
}

// The one details body (spec §9.2), shared by the grid popover and the list expansion:
// type + date, label, detail, then navigation demoted to an explicit affordance — an
// "Open {page} →" link for computed events, Edit/Delete for custom ones (no page).
export default function EventDetails({ event, onEdit, onDelete, deleting }: Props) {
  return (
    <div className="cal-event-details">
      <div className="cal-event-type">
        <span
          className="cal-legend-dot"
          style={{ backgroundColor: EVENT_COLORS[event.type] }}
          aria-hidden="true"
        />
        {EVENT_TYPE_LABELS[event.type]} · {formatDate(event.date)}
      </div>
      <div className="cal-event-label">{event.label}</div>
      {event.detail !== null && event.detail !== event.label && (
        <div className="cal-event-detail">{event.detail}</div>
      )}
      <div className="cal-event-actions">
        {event.href !== null && (
          <NavLink to={event.href} className="cal-event-open">
            Open {hrefLabel(event.href)} →
          </NavLink>
        )}
        {event.type === 'custom' && (
          <>
            <button type="button" className="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button
              type="button"
              className="button"
              disabled={deleting}
              onClick={() => onDelete(event)}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
