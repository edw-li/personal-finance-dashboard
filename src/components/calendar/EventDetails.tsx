import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { CalendarEvent, CalendarOverrideBody } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import AmountInput from '../AmountInput'
import { EVENT_TYPE_LABELS, SOURCE_COLORS, hrefLabel, isDeadline } from './calendarView'

interface Props {
  event: CalendarEvent
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  deleting: boolean
  /** Generated events only: the FULL override body (spec §13 — PUT is a full replace). */
  onOverride: (event: CalendarEvent, body: CalendarOverrideBody) => void
  saving: boolean
}

/** What the server currently holds for this event — every button edits ONE field of it. */
function overlayOf(event: CalendarEvent): CalendarOverrideBody {
  return {
    done: event.done,
    hidden: event.hidden,
    note: event.note,
    amount: event.amount_overridden ? event.amount : null,
  }
}

// The one details body (spec §7, §13), shared by the grid popover, the day drawer and the
// list expansion: type · date, label, amount with its basis, items, detail, the series, the
// note, then the verbs — Open, Edit/Delete for custom rows, Mark done / Hide / Your figure
// for generated ones.
export default function EventDetails({
  event,
  onEdit,
  onDelete,
  deleting,
  onOverride,
  saving,
}: Props) {
  const [figureOpen, setFigureOpen] = useState(false)
  const [figureBox, setFigureBox] = useState(event.amount_overridden ? (event.amount ?? '') : '')
  const [noteBox, setNoteBox] = useState(event.note ?? '')
  const generated = event.id === null
  const overlay = overlayOf(event)
  const figureValid = figureBox.trim() === '' || isAmount(figureBox, { expressions: false })

  const saveFigure = () => {
    if (!figureValid) return
    const amount = figureBox.trim() === '' ? null : canonicalAmount(figureBox, { expressions: false })
    const note = noteBox.trim() === '' ? null : noteBox.trim()
    onOverride(event, { ...overlay, amount, note })
    setFigureOpen(false)
  }

  return (
    <div className="cal-event-details">
      <div className="cal-event-type">
        <span
          className="cal-legend-dot"
          style={{ backgroundColor: SOURCE_COLORS[event.source] }}
          aria-hidden="true"
        />
        {EVENT_TYPE_LABELS[event.type]} · {formatDate(event.date)}
      </div>
      <div className={`cal-event-label${event.done ? ' is-done' : ''}`}>{event.label}</div>
      <div className="cal-event-amount">
        {event.amount === null ? (
          <span className="cal-event-unknown">Amount unknown</span>
        ) : (
          <>
            <span className="num">
              {formatCurrency(event.amount)}
              {event.direction === 'neutral' ? '' : ` ${event.direction}`}
            </span>{' '}
            <span className="badge">{event.amount_overridden ? 'your figure' : event.basis}</span>
          </>
        )}
      </div>
      {event.items.length > 0 && (
        <ul className="cal-event-items">
          {event.items.map((item, index) => (
            // The INDEX leads the key: two grants can legitimately share a label and an
            // owner (the same refresh granted twice in a year), and a duplicate key would
            // drop one of the rows.
            <li key={`${index}-${item.label}-${item.person_id ?? ''}`}>
              {item.label}
              <span className="num">{item.amount === null ? '—' : formatCurrency(item.amount)}</span>
              {item.detail !== null && ` · ${item.detail}`}
            </li>
          ))}
        </ul>
      )}
      {event.detail !== null && event.detail !== event.label && (
        <div className="cal-event-detail">{event.detail}</div>
      )}
      {/* 'none' is a real wire value, not an absence — only a real series says how it repeats. */}
      {event.recurrence !== null && event.recurrence !== 'none' && (
        <div className="cal-event-detail">
          Repeats {event.recurrence}
          {event.until !== null ? ` until ${formatDate(event.until)}` : ''}
        </div>
      )}
      {event.note !== null && <div className="cal-event-note">Note: {event.note}</div>}
      <div className="cal-event-actions">
        {event.href !== null && (
          <NavLink to={event.href} className="cal-event-open">
            Open {hrefLabel(event.href)} →
          </NavLink>
        )}
        {!generated && (
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
        {generated && isDeadline(event) && (
          <button
            type="button"
            className="button"
            disabled={saving}
            onClick={() => onOverride(event, { ...overlay, done: !event.done })}
          >
            {event.done ? 'Reopen' : 'Mark done'}
          </button>
        )}
        {generated && (
          <button
            type="button"
            className="button"
            disabled={saving}
            onClick={() => onOverride(event, { ...overlay, hidden: !event.hidden })}
          >
            {event.hidden ? 'Unhide' : 'Hide'}
          </button>
        )}
        {generated && !figureOpen && (
          <button
            type="button"
            className="button"
            disabled={saving}
            onClick={() => setFigureOpen(true)}
          >
            Your figure
          </button>
        )}
        {generated && event.amount_overridden && (
          <button
            type="button"
            className="button"
            disabled={saving}
            onClick={() => onOverride(event, { ...overlay, amount: null })}
          >
            Use the estimate
          </button>
        )}
      </div>
      {generated && figureOpen && (
        <form
          className="cal-figure-form"
          onSubmit={(e) => {
            e.preventDefault()
            saveFigure()
          }}
        >
          <label>
            Amount you paid
            <AmountInput
              kind="money"
              value={figureBox}
              onValueChange={setFigureBox}
              aria-label="Amount you paid"
              placeholder="$0.00"
            />
          </label>
          <label>
            Note
            <input
              className="field-input cal-form-input"
              aria-label="Note"
              maxLength={300}
              value={noteBox}
              onChange={(e) => setNoteBox(e.target.value)}
            />
          </label>
          <button type="submit" className="button button-primary" disabled={saving || !figureValid}>
            Save figure
          </button>
          <button type="button" className="button" onClick={() => setFigureOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
