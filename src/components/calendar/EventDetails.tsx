import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import BusyButton from '../feedback/BusyButton'
import { revealEditor, useEscapeCancel } from '../feedback/reveal'
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
  onOverride: (event: CalendarEvent, body: CalendarOverrideBody) => void | Promise<boolean>
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
  const figureRef = useRef<HTMLFormElement>(null)
  const figureButtonRef = useRef<HTMLButtonElement>(null)
  const closeFigure = () => {
    flushSync(() => setFigureOpen(false))
    figureButtonRef.current?.focus()
  }
  useEscapeCancel(figureRef, closeFigure, figureOpen)
  const generated = event.id === null
  const overlay = overlayOf(event)
  // Items that carry no money at all — the monthly reminder's pending parts (2026-09-23 spec §T6)
  // — list without an amount column: a column of dashes says nothing. A dash still marks ONE
  // unknown figure among known ones.
  const priced = event.items.some((item) => item.amount !== null)
  const figureValid = figureBox.trim() === '' || isAmount(figureBox, { expressions: false })

  const saveFigure = () => {
    if (!figureValid) return
    const amount = figureBox.trim() === '' ? null : canonicalAmount(figureBox, { expressions: false })
    const note = noteBox.trim() === '' ? null : noteBox.trim()
    const saved = onOverride(event, { ...overlay, amount, note })
    if (saved === undefined) closeFigure()
    else void saved.then((ok) => { if (ok) closeFigure() })
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
              {priced && <span className="num">{item.amount === null ? '—' : formatCurrency(item.amount)}</span>}
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
            <BusyButton type="button" className="button" onClick={() => onEdit(event)}>
              Edit
            </BusyButton>
            <BusyButton
              type="button"
              className="button"
              busy={deleting}
              onClick={() => onDelete(event)}
            >
              Delete
            </BusyButton>
          </>
        )}
        {generated && isDeadline(event) && (
          <BusyButton
            type="button"
            className="button"
            inert={saving}
            onClick={() => onOverride(event, { ...overlay, done: !event.done })}
          >
            {event.done ? 'Reopen' : 'Mark done'}
          </BusyButton>
        )}
        {generated && (
          <BusyButton
            type="button"
            className="button"
            inert={saving}
            onClick={() => onOverride(event, { ...overlay, hidden: !event.hidden })}
          >
            {event.hidden ? 'Unhide' : 'Hide'}
          </BusyButton>
        )}
        {generated && !figureOpen && (
          <BusyButton
            type="button"
            className="button"
            inert={saving}
            ref={figureButtonRef}
            onClick={() => {
              flushSync(() => {
                setFigureBox(event.amount_overridden ? (event.amount ?? '') : '')
                setNoteBox(event.note ?? '')
                setFigureOpen(true)
              })
              revealEditor(figureRef.current)
            }}
          >
            Your figure
          </BusyButton>
        )}
        {generated && event.amount_overridden && (
          <BusyButton
            type="button"
            className="button"
            inert={saving}
            onClick={() => onOverride(event, { ...overlay, amount: null })}
          >
            Use the estimate
          </BusyButton>
        )}
      </div>
      {generated && figureOpen && (
        <form
          className="cal-figure-form"
          ref={figureRef}
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
          <BusyButton type="submit" className="button button-primary" busy={saving} inert={!figureValid}>
            Save figure
          </BusyButton>
          <BusyButton type="button" className="button" onClick={closeFigure}>
            Cancel
          </BusyButton>
        </form>
      )}
    </div>
  )
}
