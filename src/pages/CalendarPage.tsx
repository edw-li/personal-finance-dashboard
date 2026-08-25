import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createCustomEvent,
  deleteCustomEvent,
  fetchCalendar,
  updateCustomEvent,
} from '../api/calendar'
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventKey,
  groupByDate,
} from '../components/calendar/calendarView'
import EventDetails from '../components/calendar/EventDetails'
import { useToast } from '../components/ToastProvider'
import type { CalendarEvent } from '../types/api'
import { formatDate, formatMonth } from '../utils/format'
import { downloadIcs } from '../utils/ics'
import { addDays, addMonths, currentMonthIso, monthGrid, todayIso } from '../utils/months'
import '../components/panels.css'
import './CalendarPage.css'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The fetched window: the shown month plus one either side, so ‹/› already have their
// out-of-month chips before the next fetch lands and the ICS export covers a quarter.
function windowFor(monthIso: string): { start: string; end: string } {
  return { start: addMonths(monthIso, -1), end: addDays(addMonths(monthIso, 2), -1) }
}

// Which surface the open event's details render on — the grid anchors a popover, the
// list (also the mobile rendering) expands inline (spec §9.2).
type OpenState = { key: string; surface: 'grid' | 'list' } | null
type FormState = { mode: 'add' } | { mode: 'edit'; id: number } | null

export default function CalendarPage() {
  const [month, setMonth] = useState<string>(currentMonthIso())
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const [open, setOpen] = useState<OpenState>(null)
  const [form, setForm] = useState<FormState>(null)
  const [fDate, setFDate] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fDetail, setFDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const addEventBtnRef = useRef<HTMLButtonElement | null>(null)
  const toast = useToast()
  // The undo closure can outlive a month change (the user pages ‹/› and THEN presses
  // Undo): the refetch must follow the month on screen, not the one captured at delete.
  // Unkeyed effect, not a render-time assignment — react-hooks/refs (EChart's idiom).
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
  })

  const load = (monthIso: string) => {
    const seq = ++seqRef.current
    const { start, end } = windowFor(monthIso)
    fetchCalendar(start, end)
      .then((data) => {
        if (seq !== seqRef.current) return
        setEvents(data.events)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the calendar.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load(month)
    // mount-only: month changes call load directly (EsppPage's selectYear pattern)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showMonth = (next: string) => {
    setMonth(next)
    setOpen(null)
    setBusy(true)
    load(next)
  }

  const reload = () => {
    setBusy(true)
    load(month)
  }

  const toggleEvent = (event: CalendarEvent, surface: 'grid' | 'list', anchor: HTMLElement) => {
    const key = eventKey(event)
    if (open !== null && open.key === key && open.surface === surface) {
      setOpen(null)
      return
    }
    anchorRef.current = anchor
    setOpen({ key, surface })
  }

  // Popover lifecycle: focus it on open (it is a dialog), Escape closes and hands focus
  // back to the chip, an outside mousedown closes the GRID popover (the list expansion
  // is an accordion — it closes by toggle or Escape, the vest-table grammar).
  useEffect(() => {
    if (open === null) return
    if (open.surface === 'grid') popoverRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(null)
      anchorRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    if (open.surface !== 'grid') {
      return () => document.removeEventListener('keydown', onKey)
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      // The chip's own mousedown must not close-then-reopen via its click toggle.
      if (anchorRef.current?.contains(target)) return
      setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const openAddForm = () => {
    setForm({ mode: 'add' })
    setFDate(todayIso())
    setFLabel('')
    setFDetail('')
    setFormError(null)
  }

  const startEdit = (event: CalendarEvent) => {
    if (event.id === null) return
    setForm({ mode: 'edit', id: event.id })
    setFDate(event.date)
    setFLabel(event.label)
    setFDetail(event.detail ?? '')
    setFormError(null)
    setOpen(null)
  }

  const saveForm = () => {
    if (form === null) return
    setSaving(true)
    const detail = fDetail.trim()
    const body = { date: fDate, label: fLabel.trim(), detail: detail === '' ? null : detail }
    const call =
      form.mode === 'add' ? createCustomEvent(body) : updateCustomEvent(form.id, body)
    call
      .then(() => {
        setForm(null)
        setBusy(true)
        load(month)
      })
      .catch((err: unknown) => {
        setFormError(err instanceof ApiError ? err.message : 'Could not save the event.')
      })
      .finally(() => setSaving(false))
  }

  const removeEvent = (event: CalendarEvent) => {
    if (event.id === null) return
    setDeleting(true)
    deleteCustomEvent(event.id)
      .then(() => {
        setOpen(null)
        // The focused Delete button unmounts with the popover — hand focus to a stable
        // landmark instead of letting it drop to <body> (the Escape path's manners).
        addEventBtnRef.current?.focus()
        setBusy(true)
        load(month)
        // Already confirm-free before this batch; the toast adds the recovery affordance
        // (2026-08-25 polish §8). Undo re-POSTs the row — a new id is acceptable.
        toast.success(`Deleted ${event.label}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCustomEvent({ date: event.date, label: event.label, detail: event.detail })
                .then(() => {
                  setBusy(true)
                  load(monthRef.current)
                })
                .catch(() => toast.error(`Could not restore ${event.label}`))
            },
          },
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not delete the event.')
      })
      .finally(() => setDeleting(false))
  }

  const today = todayIso()
  const weeks = monthGrid(month)
  const byDate = groupByDate(events ?? [])
  // The list (and the mobile rendering) shows the SHOWN month only; the grid also
  // renders the padded out-of-month days' chips, dimmed with their cells.
  const monthEvents = (events ?? []).filter((e) => e.date.slice(0, 7) === month.slice(0, 7))
  const listGroups = [...groupByDate(monthEvents).entries()]

  const details = (event: CalendarEvent) => (
    <EventDetails event={event} onEdit={startEdit} onDelete={removeEvent} deleting={deleting} />
  )

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <h1>Calendar</h1>
        <div className="spacer" />
        <button type="button" className="button" ref={addEventBtnRef} onClick={openAddForm}>
          Add event
        </button>
        <button
          type="button"
          className="button"
          disabled={events === null || events.length === 0}
          onClick={() => events !== null && downloadIcs(events)}
        >
          Add to calendar (.ics)
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {events === null ? error : `${error} — the page may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading the calendar" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {events === null ? (
        busy && <p className="empty-note">Loading…</p>
      ) : (
        <div className={`card-grid loading-dim${busy ? ' is-loading' : ''}`}>
          {form !== null && (
            <section className="card span-12">
              <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
              {formError && (
                <div className="error-banner" role="alert">
                  {formError}
                </div>
              )}
              <div className="cal-form">
                <label className="cal-form-field">
                  Date
                  <input
                    type="date"
                    className="field-input cal-form-input"
                    value={fDate}
                    onChange={(e) => setFDate(e.target.value)}
                  />
                </label>
                <label className="cal-form-field">
                  Title
                  <input
                    className="field-input cal-form-input"
                    value={fLabel}
                    maxLength={120}
                    onChange={(e) => setFLabel(e.target.value)}
                  />
                </label>
                <label className="cal-form-field cal-form-note">
                  Note (optional)
                  <input
                    className="field-input cal-form-input"
                    value={fDetail}
                    maxLength={300}
                    onChange={(e) => setFDetail(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={saving || fLabel.trim() === '' || fDate === ''}
                  onClick={saveForm}
                >
                  {form.mode === 'add' ? 'Save event' : 'Save changes'}
                </button>
                <button type="button" className="button" onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
            </section>
          )}
          <section className="card span-12">
            <div className="cal-controls">
              <button
                type="button"
                className="button"
                aria-label="Previous month"
                onClick={() => showMonth(addMonths(month, -1))}
              >
                ‹
              </button>
              <button type="button" className="button" onClick={() => showMonth(currentMonthIso())}>
                Today
              </button>
              <button
                type="button"
                className="button"
                aria-label="Next month"
                onClick={() => showMonth(addMonths(month, 1))}
              >
                ›
              </button>
              <h2 className="cal-title">{formatMonth(month)}</h2>
            </div>
            {/* Plain divs, no grid role: the date-grouped list below is the accessible
                (and mobile) rendering — spec §6. */}
            <div className="cal-grid">
              {DOW.map((dow) => (
                <div key={dow} className="cal-dow">
                  {dow}
                </div>
              ))}
              {weeks.flat().map((day, dayIndex) => {
                const outside = day.slice(0, 7) !== month.slice(0, 7)
                return (
                  <div
                    key={day}
                    className={`cal-day${outside ? ' cal-day-outside' : ''}${
                      day === today ? ' cal-day-today' : ''
                    }`}
                  >
                    <div className="cal-day-number">{Number(day.slice(8, 10))}</div>
                    {(byDate.get(day) ?? []).map((event) => {
                      const key = eventKey(event)
                      const isOpen = open?.surface === 'grid' && open.key === key
                      return (
                        <div key={key} className="cal-chip-slot">
                          <button
                            type="button"
                            className="cal-chip"
                            aria-expanded={isOpen}
                            aria-haspopup="dialog"
                            style={{ borderLeftColor: EVENT_COLORS[event.type] }}
                            onClick={(e) => toggleEvent(event, 'grid', e.currentTarget)}
                          >
                            {event.label}
                          </button>
                          {isOpen && (
                            <div
                              ref={popoverRef}
                              role="dialog"
                              aria-label={event.label}
                              tabIndex={-1}
                              className={`cal-popover${
                                dayIndex % 7 >= 5 ? ' cal-popover-right' : ''
                              }`}
                            >
                              {details(event)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div className="cal-legend">
              {EVENT_TYPE_ORDER.map((type) => (
                <span key={type} className="cal-legend-item">
                  <span
                    className="cal-legend-dot"
                    style={{ backgroundColor: EVENT_COLORS[type] }}
                    aria-hidden="true"
                  />
                  {EVENT_TYPE_LABELS[type]}
                </span>
              ))}
            </div>
            {/* The worded notes the spec requires in the legend (§5 payday row, §3.2
                data honesty): omissions and confirmed-only are said, not implied. */}
            <p className="drill-hint">
              Paydays appear only for semi-monthly (24 checks/yr) paycheck profiles — other
              cadences are omitted rather than guessed. Ex-dividend dates are confirmed
              announcements only: stocks typically publish 2–6 weeks ahead, ETFs often just
              days ahead, so a quiet stretch may simply be unannounced.
            </p>
            {events.length === 0 && (
              <p className="empty-note">
                No events in this window — vests, purchases and paydays appear once grants,
                periods and a paycheck profile are entered. Add your own with Add event.
              </p>
            )}
          </section>
          <section className="card span-12">
            <h2 className="eyebrow">{formatMonth(month)} — list</h2>
            {listGroups.length === 0 ? (
              <p className="empty-note">Nothing this month.</p>
            ) : (
              <ul className="cal-list">
                {listGroups.map(([day, dayEvents]) => (
                  <li key={day}>
                    <span className="cal-list-date">{formatDate(day)}</span>
                    <ul>
                      {dayEvents.map((event) => {
                        const key = eventKey(event)
                        const isOpen = open?.surface === 'list' && open.key === key
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className="row-toggle cal-list-item"
                              aria-expanded={isOpen}
                              onClick={(e) => toggleEvent(event, 'list', e.currentTarget)}
                            >
                              {event.label}
                              {event.detail !== null && event.detail !== event.label && (
                                <span className="cal-list-detail"> — {event.detail}</span>
                              )}
                            </button>
                            {isOpen && <div className="cal-list-expansion">{details(event)}</div>}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
