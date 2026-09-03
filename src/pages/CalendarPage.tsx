import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createCustomEvent,
  deleteCustomEvent,
  fetchCalendar,
  putCalendarOverride,
  updateCustomEvent,
} from '../api/calendar'
import { ApiError } from '../api/client'
import { fetchHousehold } from '../api/household'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import AmountInput from '../components/AmountInput'
import CalendarGrid from '../components/calendar/CalendarGrid'
import CashflowStrip from '../components/calendar/CashflowStrip'
import DayDrawer from '../components/calendar/DayDrawer'
import EventDetails from '../components/calendar/EventDetails'
import SourceHealth from '../components/calendar/SourceHealth'
import {
  chipAmount,
  eventKey,
  groupByDate,
  sortForCell,
  stripPersonSuffix,
  visibleEvents,
} from '../components/calendar/calendarView'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import Segmented from '../components/shell/Segmented'
import { useScope } from '../components/shell/useScope'
import { useToast } from '../components/ToastProvider'
import { useArrivalPair } from '../components/useArrivalParam'
import type {
  CalendarDirection,
  CalendarEvent,
  CalendarOverrideBody,
  CalendarRecurrence,
  CalendarResponse,
  CustomEventBody,
  PersonOut,
} from '../types/api'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatDate, formatMonth } from '../utils/format'
import { downloadIcs } from '../utils/ics'
import { addDays, addMonths, currentMonthIso, todayIso } from '../utils/months'
import '../components/panels.css'
import './CalendarPage.css'

// The fetched window: the shown month plus one either side, so ‹/› already have their
// out-of-month chips before the next fetch lands.
function windowFor(monthIso: string): { start: string; end: string } {
  return { start: addMonths(monthIso, -1), end: addDays(addMonths(monthIso, 2), -1) }
}

// One snapshot per shown month — the fetched window is derived from it (2026-08-27 §1).
function calendarKey(monthIso: string): string {
  return `calendar:${monthIso}`
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** The only value ?add= may carry; anything else is stripped without opening anything. */
const ADD_ARRIVALS = ['1'] as const
const ISO_MONTH = /^\d{4}-\d{2}$/
type ViewMode = 'grid' | 'list'
type FormState = { mode: 'add' } | { mode: 'edit'; id: number } | null
interface Fields {
  date: string
  label: string
  detail: string
  person: string // '' = Household; a tag is always deliberate
  amount: string
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  until: string
}
const EMPTY_FIELDS: Fields = {
  date: '',
  label: '',
  detail: '',
  person: '',
  amount: '',
  direction: 'neutral',
  recurrence: 'none',
  until: '',
}
const VIEW_OPTIONS = [
  { value: 'grid' as const, label: 'Grid' },
  { value: 'list' as const, label: 'List' },
]

export default function CalendarPage() {
  // The visible month lives in the URL (2026-09-03 calendar spec §9): null = the current
  // month, never written. No ScopeBar ribbon — ‹ Today ›, the month input and Grid/List are
  // the page's own controls, handed to the frame's scope row so the frame's `busy` dim
  // (which covers children only) never greys out the way OUT of a slow month.
  const { scope, setScope } = useScope({ month: true })
  const month = scope.month ?? currentMonthIso()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: ViewMode = searchParams.get('view') === 'list' ? 'list' : 'grid'

  const [data, setData] = useState<{ month: string; payload: CalendarResponse } | null>(() => {
    const seeded = getSnapshot<CalendarResponse>(calendarKey(month))
    return seeded === undefined ? null : { month, payload: seeded }
  })
  const [revalidating, setRevalidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const [openKey, setOpenKey] = useState<string | null>(null) // the grid's anchored popover
  const [openListKey, setOpenListKey] = useState<string | null>(null) // the list's accordion
  const [drawerDay, setDrawerDay] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState<string>(() => {
    const today = todayIso()
    return today.slice(0, 7) === month.slice(0, 7) ? today : month
  })
  const [focusTick, setFocusTick] = useState(0)
  const [form, setForm] = useState<FormState>(null)
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  // Its own fetch, outside the per-month snapshot: the roster does not change with the
  // month, and folding it in would invalidate every cached month.
  const [people, setPeople] = useState<PersonOut[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [overriding, setOverriding] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const addEventBtnRef = useRef<HTMLButtonElement | null>(null)
  const toast = useToast()
  // Undo closures and the arrival handler can outlive a month change: they read the month
  // on screen through this ref (unkeyed effect, not a render-time assignment).
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
  })

  useEffect(() => {
    fetchHousehold()
      .then((household) => setPeople(household.people))
      .catch(() => setPeople([]))
  }, [])

  const load = (monthIso: string) => {
    const seq = ++seqRef.current
    const { start, end } = windowFor(monthIso)
    fetchCalendar(start, end)
      .then((payload) => {
        if (seq !== seqRef.current) return
        setSnapshot(calendarKey(monthIso), payload)
        setError(null)
        // Identical payload for the same month: nothing re-renders (the snapshot rule).
        setData((current) =>
          current !== null &&
          current.month === monthIso &&
          JSON.stringify(current.payload) === JSON.stringify(payload)
            ? current
            : { month: monthIso, payload },
        )
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the calendar.')
      })
      .finally(() => {
        if (seq === seqRef.current) setRevalidating(false)
      })
  }

  // The URL is the month's source of truth, so the fetch follows it — back/forward, a deep
  // link, ‹ ›, PageDown and land-on-save all arrive here. `load` is a plain function over
  // stable setters (the house idiom).
  useEffect(() => {
    load(month)
  }, [month])

  // What is on screen: this month's payload, else its snapshot (paged-to before its fetch
  // lands), else the previous month's payload dimmed under `busy` — whose window is the
  // month ± one, so it already holds this month's events. Derived, never seeded from an
  // effect.
  const shown: CalendarResponse | null =
    data !== null && data.month === month
      ? data.payload
      : (getSnapshot<CalendarResponse>(calendarKey(month)) ?? data?.payload ?? null)
  const busy = revalidating || data === null || data.month !== month
  const visible = shown === null ? [] : visibleEvents(shown.events)
  const byDate = groupByDate(visible)

  const revalidate = (monthIso: string) => {
    setRevalidating(true)
    load(monthIso)
  }

  const showMonth = (next: string) => {
    setOpenKey(null)
    setDrawerDay(null)
    setScope({ month: next === currentMonthIso() ? null : next })
  }

  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'list') params.set('view', 'list')
    else params.delete('view')
    setSearchParams(params, { replace: true })
  }

  // Popover lifecycle (the v1 grammar): focus on open, Escape closes and refocuses the chip,
  // an outside mousedown closes.
  useEffect(() => {
    if (openKey === null) return
    popoverRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenKey(null)
      anchorRef.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      // The chip's own mousedown must not close-then-reopen via its click toggle.
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpenKey(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [openKey])

  const toggleEvent = (event: CalendarEvent, anchor: HTMLElement) => {
    if (openKey === event.key) {
      setOpenKey(null)
      return
    }
    anchorRef.current = anchor
    setDrawerDay(null)
    setOpenKey(event.key)
  }

  const openDay = (day: string) => {
    setOpenKey(null)
    setActiveDay(day)
    setDrawerDay(day)
  }

  const closeDrawer = () => {
    setDrawerDay(null)
    setFocusTick((tick) => tick + 1) // the grid pulls focus back to the active cell
  }

  // Primary first, then by id — the order every other person control on the site uses.
  const orderedPeople = [...people].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
  )
  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  // GET /calendar stamps " — <name>" into a tagged event's label. Anything that re-saves
  // the row starts from the STAMPED text, so it peels first — otherwise the next compose
  // stamps a second copy.
  const rawLabel = (event: CalendarEvent): string =>
    event.person_id === null
      ? event.label
      : stripPersonSuffix(event.label, ownerName.get(event.person_id))

  /** The custom row exactly as it is stored — what a re-save or a restore must send back.
   *  A series is identified by its START: the payload's `date` is the occurrence on screen,
   *  and sending that would re-anchor the whole series to whatever day was clicked. */
  const storedBody = (event: CalendarEvent): CustomEventBody => ({
    date: event.series_start ?? event.date,
    label: rawLabel(event),
    detail: event.detail,
    person_id: event.person_id,
    amount: event.amount,
    direction: event.direction,
    recurrence: event.recurrence ?? 'none',
    until: event.until,
  })

  // Defaults to the VIEWED month's first day, or the day handed in (spec §8). useCallback
  // over stable setters and a ref: the arrival effect depends on it.
  const openAddForm = useCallback((day?: string) => {
    setForm({ mode: 'add' })
    setFields({ ...EMPTY_FIELDS, date: day ?? monthRef.current })
    setFormError(null)
    setOpenKey(null)
    setDrawerDay(null)
  }, [])

  // ?add=1 (the palette) opens the form; ?add=1&date=YYYY-MM-DD prefills it and views that
  // day's month. Both params are consumed in ONE replace, and the month this jumps to rides
  // along in the same write — useArrivalPair hands the params object over for exactly that.
  const arriveOnAdd = useCallback(
    (_value: '1', rawDate: string | null, params: URLSearchParams) => {
      const day = rawDate !== null && ISO_DAY.test(rawDate) ? rawDate : undefined
      openAddForm(day)
      if (day !== undefined && day.slice(0, 7) !== monthRef.current.slice(0, 7)) {
        if (day.slice(0, 7) === currentMonthIso().slice(0, 7)) params.delete('month')
        else params.set('month', day.slice(0, 7))
      }
    },
    [openAddForm],
  )
  useArrivalPair('add', ADD_ARRIVALS, 'date', arriveOnAdd)

  const startEdit = (event: CalendarEvent) => {
    if (event.id === null) return
    const stored = storedBody(event)
    setForm({ mode: 'edit', id: event.id })
    // Every field the PATCH will replace is stashed here, money and series included: the
    // form IS the body, so a field the form never showed would be sent as its empty value.
    setFields({
      date: stored.date,
      label: stored.label,
      detail: stored.detail ?? '',
      person: stored.person_id === null ? '' : String(stored.person_id),
      amount: stored.amount ?? '',
      direction: stored.direction,
      recurrence: stored.recurrence,
      until: stored.until ?? '',
    })
    setFormError(null)
    setOpenKey(null)
    setOpenListKey(null)
    setDrawerDay(null)
  }

  // Land on the saved date: the grid moves there and the window containing it is fetched.
  const landOn = (day: string) => {
    setActiveDay(day)
    const target = `${day.slice(0, 7)}-01`
    if (target !== monthRef.current) showMonth(target)
    else revalidate(target)
  }

  const saveForm = () => {
    if (form === null) return
    const amountText = fields.amount.trim()
    if (amountText !== '' && !isAmount(amountText, { expressions: false })) {
      setFormError('Amount must be a plain number.')
      return
    }
    if (fields.recurrence !== 'none' && fields.until !== '' && fields.until < fields.date) {
      setFormError('Until must be on or after the date.')
      return
    }
    const detail = fields.detail.trim()
    const body: CustomEventBody = {
      date: fields.date,
      label: fields.label.trim(),
      detail: detail === '' ? null : detail,
      person_id: fields.person === '' ? null : Number(fields.person),
      amount: amountText === '' ? null : canonicalAmount(amountText, { expressions: false }),
      // No amount means no direction to have — "money out of nothing" is not a fact.
      direction: amountText === '' ? 'neutral' : fields.direction,
      recurrence: fields.recurrence,
      until: fields.recurrence === 'none' || fields.until === '' ? null : fields.until,
    }
    setSaving(true)
    const call = form.mode === 'add' ? createCustomEvent(body) : updateCustomEvent(form.id, body)
    call
      .then(() => {
        setForm(null)
        landOn(body.date)
      })
      .catch((err: unknown) =>
        setFormError(err instanceof ApiError ? err.message : 'Could not save the event.'),
      )
      .finally(() => setSaving(false))
  }

  const removeEvent = (event: CalendarEvent) => {
    if (event.id === null) return
    const restore = storedBody(event)
    setDeleting(true)
    deleteCustomEvent(event.id)
      .then(() => {
        setOpenKey(null)
        setDrawerDay(null)
        // The focused Delete button unmounts with the popover — hand focus to a stable
        // landmark instead of letting it drop to <body>.
        addEventBtnRef.current?.focus()
        revalidate(monthRef.current)
        // Already confirm-free; the toast carries the recovery affordance. Undo re-POSTs the
        // row — a new id is acceptable.
        toast.success(`Deleted ${event.label}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCustomEvent(restore)
                .then(() => revalidate(monthRef.current))
                .catch(() => toast.error(`Could not restore ${event.label}`))
            },
          },
        })
      })
      // A toast, not the frame's stale line: the month on screen came back fine and is still
      // true, so raising it would blame the calendar for a write that failed.
      .catch((err: unknown) =>
        toast.error(err instanceof ApiError ? err.message : 'Could not delete the event.'),
      )
      .finally(() => setDeleting(false))
  }

  // Generated events: the user's edits are an overlay keyed by the event key (spec §13).
  const applyOverride = (event: CalendarEvent, body: CalendarOverrideBody) => {
    setOverriding(true)
    putCalendarOverride(event.key, body)
      .then(() => {
        revalidate(monthRef.current)
        if (body.hidden && !event.hidden) {
          setOpenKey(null)
          toast.success(`Hidden ${event.label}`, {
            action: {
              label: 'Undo',
              onAction: () => {
                putCalendarOverride(event.key, { ...body, hidden: false })
                  .then(() => revalidate(monthRef.current))
                  .catch(() => toast.error(`Could not unhide ${event.label}`))
              },
            },
          })
        }
      })
      .catch((err: unknown) =>
        toast.error(err instanceof ApiError ? err.message : 'Could not save the change.'),
      )
      .finally(() => setOverriding(false))
  }

  const renderDetails = (event: CalendarEvent) => (
    <EventDetails
      event={event}
      onEdit={startEdit}
      onDelete={removeEvent}
      deleting={deleting}
      onOverride={applyOverride}
      saving={overriding}
    />
  )

  const field =
    <K extends keyof Fields>(key: K) =>
    (value: Fields[K]) =>
      setFields((current) => ({ ...current, [key]: value }))
  // The list shows the SHOWN month only, hidden rows included (dimmed) so Unhide is reachable.
  const monthEvents = (shown?.events ?? []).filter((e) => e.date.slice(0, 7) === month.slice(0, 7))
  const listGroups = [...groupByDate(monthEvents).entries()]

  return (
    <div className="page calendar-page">
      <PageFrame
        title="Calendar"
        actions={
          <>
            <button type="button" className="button" ref={addEventBtnRef} onClick={() => openAddForm()}>
              Add event
            </button>
            <button
              type="button"
              className="button"
              disabled={shown === null || shown.events.length === 0}
              onClick={() => shown !== null && downloadIcs(shown.events)}
            >
              Add to calendar (.ics)
            </button>
          </>
        }
        scopeRow={
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
            <input
              type="month"
              className="field-input cal-month-input"
              aria-label="Jump to month"
              value={month.slice(0, 7)}
              onChange={(e) => {
                if (ISO_MONTH.test(e.target.value)) showMonth(`${e.target.value}-01`)
              }}
            />
            <h2 className="cal-title">{formatMonth(month)}</h2>
            <div className="spacer" />
            <Segmented
              variant="toggle"
              ariaLabel="Calendar view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
          </div>
        }
        resource={{
          status: shown === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy,
          retry: () => revalidate(month),
        }}
        skeleton={{ tiles: 4, cards: [{ span: 12, height: 420 }] }}
      >
        {shown !== null && (
          <>
            <CashflowStrip events={visible} month={month} quoteAsOf={shown.quote_as_of} />
            <div className="card-grid">
              {form !== null && (
                <section className="card span-12">
                  <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
                  <FeedBanner error={formError} />
                  <div className="cal-form">
                    <label className="cal-form-field">
                      Date
                      <input
                        type="date"
                        className="field-input cal-form-input"
                        value={fields.date}
                        onChange={(e) => field('date')(e.target.value)}
                      />
                    </label>
                    <label className="cal-form-field">
                      Title
                      <input
                        className="field-input cal-form-input"
                        value={fields.label}
                        maxLength={120}
                        onChange={(e) => field('label')(e.target.value)}
                      />
                    </label>
                    <label className="cal-form-field cal-form-note">
                      Note (optional)
                      <input
                        className="field-input cal-form-input"
                        value={fields.detail}
                        maxLength={300}
                        onChange={(e) => field('detail')(e.target.value)}
                      />
                    </label>
                    {orderedPeople.length > 1 && (
                      <label className="cal-form-field">
                        Person
                        <select
                          className="field-input cal-form-input"
                          value={fields.person}
                          onChange={(e) => field('person')(e.target.value)}
                        >
                          <option value="">Household</option>
                          {orderedPeople.map((person) => (
                            <option key={person.id} value={String(person.id)}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="cal-form-field">
                      Amount (optional)
                      <AmountInput
                        kind="money"
                        className="cal-form-input"
                        value={fields.amount}
                        onValueChange={field('amount')}
                        aria-label="Amount (optional)"
                        placeholder="$0.00"
                      />
                    </label>
                    <label className="cal-form-field">
                      Direction
                      <select
                        className="field-input cal-form-input"
                        value={fields.direction}
                        onChange={(e) => field('direction')(e.target.value as CalendarDirection)}
                      >
                        <option value="neutral">No direction</option>
                        <option value="in">Money in</option>
                        <option value="out">Money out</option>
                      </select>
                    </label>
                    <label className="cal-form-field">
                      Repeats
                      <select
                        className="field-input cal-form-input"
                        value={fields.recurrence}
                        onChange={(e) => field('recurrence')(e.target.value as CalendarRecurrence)}
                      >
                        <option value="none">Never</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </label>
                    {fields.recurrence !== 'none' && (
                      <label className="cal-form-field">
                        Until (optional)
                        <input
                          type="date"
                          className="field-input cal-form-input"
                          value={fields.until}
                          onChange={(e) => field('until')(e.target.value)}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={saving || fields.label.trim() === '' || fields.date === ''}
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
                {view === 'grid' ? (
                  <CalendarGrid
                    month={month}
                    events={visible}
                    today={todayIso()}
                    activeDay={activeDay}
                    focusTick={focusTick}
                    openKey={openKey}
                    popoverRef={popoverRef}
                    renderDetails={renderDetails}
                    onActiveDay={setActiveDay}
                    onOpenDay={openDay}
                    onToggleEvent={toggleEvent}
                    onMonthStep={(delta) => showMonth(addMonths(month, delta))}
                  />
                ) : listGroups.length === 0 ? (
                  <p className="empty-note">Nothing this month.</p>
                ) : (
                  <ul className="cal-list">
                    {listGroups.map(([day, dayEvents]) => (
                      <li key={day}>
                        <span className="cal-list-date">{formatDate(day)}</span>
                        <ul>
                          {dayEvents.map((event) => {
                            const key = eventKey(event)
                            const isOpen = openListKey === key
                            const amount = chipAmount(event)
                            return (
                              <li key={key}>
                                <button
                                  type="button"
                                  className={`row-toggle cal-list-item${event.hidden ? ' is-hidden' : ''}${event.done ? ' is-done' : ''}`}
                                  aria-expanded={isOpen}
                                  onClick={() => setOpenListKey(isOpen ? null : key)}
                                >
                                  {event.label}
                                  {event.hidden && <span className="cal-list-detail"> (hidden)</span>}
                                  {amount !== null && (
                                    <span className="cal-list-amount num"> {amount}</span>
                                  )}
                                  {event.items.length > 0 && (
                                    <span className="cal-list-detail">
                                      {' — '}
                                      {event.items
                                        .map(
                                          (i) =>
                                            `${i.label} ${i.amount === null ? '—' : `$${i.amount}`}`,
                                        )
                                        .join(', ')}
                                    </span>
                                  )}
                                </button>
                                {isOpen && (
                                  <div className="cal-list-expansion">{renderDetails(event)}</div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                <SourceHealth sources={shown.sources} />
                {shown.events.length === 0 && (
                  <p className="empty-note">
                    No events in this window — vests, purchases, paydays and card dates appear once
                    grants, periods, a paycheck profile and cards are entered. Add your own with Add
                    event.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </PageFrame>
      {drawerDay !== null && (
        <DayDrawer
          day={drawerDay}
          events={sortForCell(byDate.get(drawerDay) ?? [])}
          onClose={closeDrawer}
          onAddOnDay={(day) => {
            closeDrawer()
            openAddForm(day)
          }}
          renderDetails={renderDetails}
        />
      )}
    </div>
  )
}
