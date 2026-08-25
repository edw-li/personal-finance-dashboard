import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchCalendar } from '../api/calendar'
import {
  EVENT_COLORS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  groupByDate,
} from '../components/calendar/calendarView'
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

export default function CalendarPage() {
  const [month, setMonth] = useState<string>(currentMonthIso())
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

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
    setBusy(true)
    load(next)
  }

  const reload = () => {
    setBusy(true)
    load(month)
  }

  const today = todayIso()
  const weeks = monthGrid(month)
  const byDate = groupByDate(events ?? [])
  // The list (and the mobile rendering) shows the SHOWN month only; the grid also
  // renders the padded out-of-month days' chips, dimmed with their cells.
  const monthEvents = (events ?? []).filter((e) => e.date.slice(0, 7) === month.slice(0, 7))
  const listGroups = [...groupByDate(monthEvents).entries()]

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <h1>Calendar</h1>
        <div className="spacer" />
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
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          <section className="card">
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
              {weeks.flat().map((day) => {
                const outside = day.slice(0, 7) !== month.slice(0, 7)
                return (
                  <div
                    key={day}
                    className={`cal-day${outside ? ' cal-day-outside' : ''}${
                      day === today ? ' cal-day-today' : ''
                    }`}
                  >
                    <div className="cal-day-number">{Number(day.slice(8, 10))}</div>
                    {(byDate.get(day) ?? []).map((event) => (
                      <NavLink
                        key={`${event.type}-${event.date}-${event.label}`}
                        className="cal-chip"
                        to={event.href}
                        title={event.detail ?? event.label}
                        style={{ borderLeftColor: EVENT_COLORS[event.type] }}
                      >
                        {event.label}
                      </NavLink>
                    ))}
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
                periods and a paycheck profile are entered.
              </p>
            )}
          </section>
          <section className="card">
            <h2 className="eyebrow">{formatMonth(month)} — list</h2>
            {listGroups.length === 0 ? (
              <p className="empty-note">Nothing this month.</p>
            ) : (
              <ul className="cal-list">
                {listGroups.map(([day, dayEvents]) => (
                  <li key={day}>
                    <span className="cal-list-date">{formatDate(day)}</span>
                    <ul>
                      {dayEvents.map((event) => (
                        <li key={`${event.type}-${event.label}`}>
                          <NavLink to={event.href} className="cal-list-link">
                            {event.label}
                          </NavLink>
                          {event.detail !== null && event.detail !== event.label && (
                            <span className="cal-list-detail"> — {event.detail}</span>
                          )}
                        </li>
                      ))}
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
