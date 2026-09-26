import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { undoBatch } from '../api/lifecycle'
import { errorDetail } from '../api/client'
import { useDeleteWithUndo } from '../components/feedback/useDeleteWithUndo'
import { useSaveState } from '../components/feedback/useSaveState'
import { SaveStatus } from '../components/feedback/SaveStatus'
import { flashElement, revealEditor } from '../components/feedback/reveal'
import { useLatest } from '../components/reorder/useLatest'
import { useSearchParams } from 'react-router-dom'
import {
  createCustomEvent,
  deleteCustomEvent,
  fetchCalendar,
  putCalendarOverrideLogged,
  updateCustomEvent,
} from '../api/calendar'
import { downloadCalendarIcs } from '../api/calendarFeed'
import { ApiError, describeError } from '../api/client'
import { fetchHousehold } from '../api/household'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import AddEventForm, { type EventFields } from '../components/calendar/AddEventForm'
import CalendarGrid, { dayInMonth } from '../components/calendar/CalendarGrid'
import CashflowStrip, { CashflowNotes } from '../components/calendar/CashflowStrip'
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
import { useDetailPanel } from '../components/details/DetailPanelProvider'
import PageFrame from '../components/shell/PageFrame'
import Segmented from '../components/shell/Segmented'
import { useScope } from '../components/shell/useScope'
import { useToast } from '../components/ToastProvider'
import { useArrivalPair } from '../components/useArrivalParam'
import type {
  CalendarEvent,
  CalendarOverrideBody,
  CalendarResponse,
  CustomEventBody,
  PersonOut,
} from '../types/api'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatDate } from '../utils/format'
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
/** `day` is the day the form was opened FOR (the drawer's "Add event on …", ?add=1&date=) — the
 *  panel's title; the date box itself is `fields.date` and may be edited away from it. */
type FormState = { mode: 'add'; day?: string } | { mode: 'edit'; id: number } | null
/** One surface for add and edit: reopening the id updates the panel instead of stacking a second. */
const FORM_PANEL_ID = 'calendar-add'
/** Every box empty. '' = unset; the form IS the body a save sends, so a field the PATCH replaces
 *  has a box here even when the form does not show it (a one-off's `until`). Kept in the page, not
 *  the form module: a value export beside a component costs a react-refresh warning. */
const EMPTY_FIELDS: EventFields = {
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
  // Where the user last pointed. The grid reads `cursorDay` below, not this — see there.
  const [activeDay, setActiveDay] = useState<string>(todayIso)
  const [focusTick, setFocusTick] = useState(0)
  // Bumped whenever the form is opened, so the caret lands in it rather than wherever the
  // button that opened it used to be (the drawer's "Add event on …" unmounts with it).
  const [formTick, setFormTick] = useState(0)
  const formDateRef = useRef<HTMLInputElement | null>(null)
  const formTitleRef = useRef<HTMLInputElement | null>(null)
  const landingRef = useRef<{ id: number; day: string; focus?: boolean } | null>(null)
  const formReturnRef = useRef<{ key: string; day: string } | null>(null)
  const deleteWithUndo = useDeleteWithUndo()
  const [form, setForm] = useState<FormState>(null)
  const [fields, setFields] = useState<EventFields>(EMPTY_FIELDS)
  // Its own fetch, outside the per-month snapshot: the roster does not change with the
  // month, and folding it in would invalidate every cached month.
  const [people, setPeople] = useState<PersonOut[]>([])
  const [baseline, setBaseline] = useState<EventFields>(EMPTY_FIELDS)
  const saveState = useSaveState({ dirty: form !== null && JSON.stringify(fields) !== JSON.stringify(baseline) })
  const clearSaveError = saveState.clearError
  const saving = saveState.status === 'saving'
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [overriding, setOverriding] = useState<Set<string>>(new Set())
  const [overlays, setOverlays] = useState<Map<string, CalendarOverrideBody>>(new Map())
  const anchorRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const addEventBtnRef = useRef<HTMLButtonElement | null>(null)
  const toast = useToast()
  // The add/edit form's surface (2026-09-13 polish spec §12): the shell's detail panel when the
  // shell provides one — the grid narrows beside the dock instead of dropping 206px under a new
  // card (audit C-4) — and the old inline card in tests and embeds, where useDetailPanel() is null.
  const panel = useDetailPanel()
  const hasPanel = panel !== null
  const openPanel = panel?.open
  const closePanel = panel?.close
  // The panel receives a STABLE host node; the form itself is portaled into that node from this
  // tree, so every keystroke re-renders the form in place without reopening the panel (ChartCard's
  // detail-host idiom).
  const [formHost] = useState(() => document.createElement('div'))
  const formHostMount = useMemo(
    () => (
      <div
        ref={(node) => {
          if (node && formHost.parentNode !== node) node.appendChild(formHost)
          else if (!node) formHost.parentNode?.removeChild(formHost)
        }}
      />
    ),
    [formHost],
  )
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
    return fetchCalendar(start, end)
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
        setError(describeError(err, 'the calendar'))
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
  const storedShown: CalendarResponse | null =
    data !== null && data.month === month
      ? data.payload
      : (getSnapshot<CalendarResponse>(calendarKey(month)) ?? data?.payload ?? null)
  const shown = useMemo(() => storedShown === null ? null : { ...storedShown, events: storedShown.events.map((event) => {
    const overlay = overlays.get(event.key)
    return overlay === undefined ? event : { ...event, done: overlay.done, hidden: overlay.hidden,
      note: overlay.note, amount: overlay.amount ?? event.amount, amount_overridden: overlay.amount !== null }
  }) }, [storedShown, overlays])
  const busy = revalidating || data === null || data.month !== month
  const visible = shown === null ? [] : visibleEvents(shown.events)
  const byDate = groupByDate(visible)
  // The roving tab stop, and the ONLY day the grid is told about. Derived from the month
  // on screen, never seeded from an effect: the controls are not the only thing that
  // changes the month — Back/Forward, a pasted ?month= link and the palette write the
  // scope directly, and a cursor stranded in a month that is no longer shown leaves the
  // grid with no tab stop at all (2026-09-09 audit item 13). Inside the shown month the
  // user's own day wins, so ‹ ›'s same-day clamp and a Back to where they were both hold;
  // outside it the cursor falls to today, else to the first of the month.
  const cursorDay =
    activeDay.slice(0, 7) === month.slice(0, 7)
      ? activeDay
      : todayIso().slice(0, 7) === month.slice(0, 7)
        ? todayIso()
        : month

  const cursorRef = useLatest(cursorDay)
  const viewRef = useLatest(view)
  const eventElement = (key: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-event-key]'))
    .find((element) => element.dataset.eventKey === key && !element.closest('[hidden]')) ?? null
  const dayElement = (day: string) => document.querySelector<HTMLElement>(`[role="gridcell"][data-day="${day}"]`)
  const focusDay = (day: string) => (dayElement(day) ?? addEventBtnRef.current)?.focus({ preventScroll: true })
  const revalidate = (monthIso: string) => {
    setRevalidating(true)
    return load(monthIso)
  }
  const reloadRef = useLatest(revalidate)

  // The POST can finish before the chip's refresh. Retain the id until that chip actually mounts.
  useEffect(() => {
    const pending = landingRef.current
    if (!pending) return
    const event = shown?.events.find((row) => row.id === pending.id && row.date === pending.day)
    if (!event) return
    const frame = requestAnimationFrame(() => {
      const chip = eventElement(event.key)
      if (!chip) return
      flashElement(chip)
      if (pending.focus) chip.focus()
      landingRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [shown, drawerDay, openListKey])

  const showMonth = (next: string) => {
    setOpenKey(null)
    setDrawerDay(null)
    setScope({ month: next === currentMonthIso() ? null : next })
  }

  // Mouse navigation carries the keyboard cursor with it (2026-09-09 audit item 13): only
  // the active day's cell is in the tab order, so a month reached by ‹ ›, Today or the
  // month box used to have no tab stop at all — Tab fell straight past the grid. The
  // keyboard's own month steps (PageUp/PageDown, an arrow off the edge) set the day
  // themselves and still call `showMonth` directly, as does landing on a saved event.
  const goToMonth = (next: string, day: string) => {
    setActiveDay(day)
    showMonth(next)
  }

  // ‹ › keep the day of month, clamped — the move PageUp/PageDown already make.
  const stepMonth = (delta: 1 | -1) => {
    const next = addMonths(month, delta)
    goToMonth(next, dayInMonth(next, cursorDay))
  }

  // `view` is the page's own param, not the shell's scope, so it is written straight
  // through instead of via setScope. That means it seeds from the RENDER's searchParams,
  // OUTSIDE useScope's pending-write coalescing — safe only because nothing here writes the
  // URL twice in one tick: ‹ › / Today / Jump and this toggle are separate discrete clicks
  // (React flushes each write before the next can be dispatched), and useScope's arrival
  // normalization settles on the first commit, before any of them. A future control that
  // wrote month AND view together would have to go through setScope, or it would drop the
  // month it did not know about.
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

  // Defaults to the active day, or the day handed in (polish §5.3). useCallback
  // over stable setters and a ref: the arrival effect depends on it.
  const openAddForm = useCallback((day?: string) => {
    setForm({ mode: 'add', day })
    const initial = { ...EMPTY_FIELDS, date: day ?? cursorRef.current }
    setFields(initial)
    setBaseline(initial)
    clearSaveError()
    formReturnRef.current = null
    setFormError(null)
    setOpenKey(null)
    setDrawerDay(null)
    setFormTick((tick) => tick + 1)
  }, [cursorRef, clearSaveError])

  // The caret lands in the date box when the form opens; tick 0 is the initial render, where there
  // is no form. Inline, the box is mounted by the time this runs. In the panel it is attached only
  // once the provider has rendered the aside — and the provider's own effect then focuses the
  // aside — so the move waits a frame and runs after it. A DOM call, no state.
  const formShown = form !== null && (panel === null || panel.activeId === FORM_PANEL_ID)
  useEffect(() => {
    if (formTick === 0 || !formShown) return
    if (!hasPanel) {
      revealEditor(formDateRef.current?.form ?? null, form?.mode === 'edit' ? '#cal-event-title' : '#cal-event-date')
      return
    }
    const frame = requestAnimationFrame(() => revealEditor(formDateRef.current?.form ?? null, form?.mode === 'edit' ? '#cal-event-title' : '#cal-event-date'))
    return () => cancelAnimationFrame(frame)
  }, [formTick, formShown, hasPanel, form?.mode])

  // The panel follows the form: open (or retitle) it while a form is up, close it when the form
  // goes. Save and Cancel end here; a close the panel itself started (×, Escape) has already
  // cleared the form through onClose, and closePanel finds nothing to close.
  const formTitle =
    form === null
      ? null
      : form.mode === 'edit'
        ? 'Edit event'
        : form.day === undefined
          ? 'Add event'
          : `Add event on ${formatDate(form.day)}`
  useEffect(() => {
    if (openPanel === undefined || closePanel === undefined) return
    if (formTitle === null) {
      closePanel(FORM_PANEL_ID)
      return
    }
    openPanel({
      id: FORM_PANEL_ID,
      title: formTitle,
      content: formHostMount,
      // Where focus lands when the panel closes: the header's Add event button — a landmark that
      // outlives whichever button opened the form (the drawer's unmounts with the drawer).
      returnTo: addEventBtnRef.current,
      onClose: () => setForm(null),
    })
  }, [formTitle, openPanel, closePanel, formHostMount])
  // Leaving the page takes the form's panel with it.
  useEffect(() => () => closePanel?.(FORM_PANEL_ID), [closePanel])

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
    const initial: EventFields = {
      date: stored.date,
      label: stored.label,
      detail: stored.detail ?? '',
      person: stored.person_id === null ? '' : String(stored.person_id),
      amount: stored.amount ?? '',
      direction: stored.direction,
      recurrence: stored.recurrence,
      until: stored.until ?? '',
    }
    setFields(initial)
    setBaseline(initial)
    saveState.clearError()
    formReturnRef.current = { key: event.key, day: event.date }
    setFormTick((tick) => tick + 1)
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
    return reloadRef.current(target)
  }

  const saveForm = () => {
    if (form === null || saving || saveState.status === 'clean' || saveState.status === 'saved' || !fields.label.trim() || !fields.date) return
    const amountText = fields.amount.trim()
    if (amountText !== '' && !isAmount(amountText, { expressions: false })) {
      setFormError('Amount must be a plain number.')
      document.getElementById('cal-event-amount')?.focus()
      return
    }
    if (fields.recurrence !== 'none' && fields.until !== '' && fields.until < fields.date) {
      setFormError('Until must be on or after the date.')
      document.getElementById('cal-event-until')?.focus()
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
    setFormError(null)
    void saveState.run(async () => {
      const saved = await (form.mode === 'add' ? createCustomEvent(body) : updateCustomEvent(form.id, body))
      landingRef.current = { id: saved.id, day: body.date }
      setBaseline(fields)
      setForm(null)
      await landOn(body.date)
      setFocusTick((tick) => tick + 1)
      requestAnimationFrame(() => {
        if (viewRef.current === 'list') {
          const event = document.querySelector<HTMLElement>(`[data-custom-event-id="${saved.id}"]`)
          ;(event ?? addEventBtnRef.current)?.focus()
        } else focusDay(body.date)
      })
    })
  }

  const cancelForm = () => {
    setForm(null)
    setFormError(null)
    saveState.clearError()
    requestAnimationFrame(() => {
      const back = formReturnRef.current
      ;(back ? eventElement(back.key) ?? dayElement(back.day) ?? addEventBtnRef.current : addEventBtnRef.current)?.focus()
    })
  }

  const markPending = (set: typeof setDeleting, key: string, pending: boolean) => set((current) => {
    const next = new Set(current)
    if (pending) next.add(key)
    else next.delete(key)
    return next
  })

  const removeEvent = (event: CalendarEvent) => {
    if (event.id === null || deleting.has(event.key)) return
    const id = event.id
    markPending(setDeleting, event.key, true)
    void deleteWithUndo({
      name: event.label,
      row: eventElement(event.key),
      request: () => deleteCustomEvent(id),
      onDeleted: async () => {
        setOpenKey(null)
        setOpenListKey(null)
        setDrawerDay(null)
        await reloadRef.current(monthRef.current)
      },
      focusAfter: () => dayElement(event.date) ?? addEventBtnRef.current,
      onRestored: async () => {
        landingRef.current = { id, day: event.date, focus: true }
        await landOn(event.date)
        // Let the refreshed grid commit before deciding that this day needs its drawer.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        // A crowded day may not show this chip in its first three slots. Its drawer does.
        if (viewRef.current === 'grid' && !eventElement(event.key)) setDrawerDay(event.date)
      },
      restoredRow: () => eventElement(event.key) ?? dayElement(event.date) ?? addEventBtnRef.current,
    }).finally(() => markPending(setDeleting, event.key, false))
  }

  // Overlays are optimistic by event key; another event remains available while one saves.
  const applyOverride = async (event: CalendarEvent, body: CalendarOverrideBody): Promise<boolean> => {
    if (overriding.has(event.key)) return false
    markPending(setOverriding, event.key, true)
    setOverlays((current) => new Map(current).set(event.key, body))
    if (body.hidden && !event.hidden) {
      setOpenKey(null)
      requestAnimationFrame(() => focusDay(event.date))
    }
    try {
      const { batchId } = await putCalendarOverrideLogged(event.key, body)
      await reloadRef.current(monthRef.current)
      const verb = body.hidden !== event.hidden ? (body.hidden ? 'Hid' : 'Showed')
        : body.done !== event.done ? (body.done ? 'Marked' : 'Reopened') : 'Updated'
      const message = `${verb} ${event.label}${body.done !== event.done && body.done ? ' done' : ''}`
      toast.success(message, batchId === null ? undefined : { action: { label: 'Undo', onAction: () => {
        markPending(setOverriding, event.key, true)
        void undoBatch(batchId).then(async () => {
          await reloadRef.current(monthRef.current)
          requestAnimationFrame(() => {
            const restored = eventElement(event.key)
            flashElement(restored)
            ;(restored ?? dayElement(event.date) ?? addEventBtnRef.current)?.focus()
          })
          toast.success(`Restored ${event.label}`)
        }).catch((err: unknown) => { toast.error(errorDetail(err)); focusDay(cursorRef.current) })
          .finally(() => markPending(setOverriding, event.key, false))
      } } })
      return true
    } catch (err) {
      toast.error(errorDetail(err))
      return false
    } finally {
      setOverlays((current) => { const next = new Map(current); next.delete(event.key); return next })
      markPending(setOverriding, event.key, false)
    }
  }

  const renderDetails = (event: CalendarEvent) => (
    <EventDetails
      event={event}
      onEdit={startEdit}
      onDelete={removeEvent}
      deleting={deleting.has(event.key)}
      onOverride={applyOverride}
      saving={overriding.has(event.key)}
    />
  )

  const field =
    <K extends keyof EventFields>(key: K) =>
    (value: EventFields[K]) =>
      { setFormError(null); saveState.clearError(); setFields((current) => ({ ...current, [key]: value })) }
  const eventForm =
    form === null ? null : (
      <AddEventForm
        mode={form.mode}
        fields={fields}
        onField={field}
        people={orderedPeople}
        error={formError}
        saveState={saveState}
        onSave={saveForm}
        onCancel={cancelForm}
        dateRef={formDateRef}
        titleRef={formTitleRef}
        hosted={hasPanel ? 'panel' : 'card'}
      />
    )
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
            {form === null && <SaveStatus state={saveState} />}
            <button
              type="button"
              className="button"
              disabled={shown === null || shown.events.length === 0}
              onClick={() => {
                // The server re-composes the window (spec §11): the file carries overrides,
                // folded items and alarms the page's own event list never held.
                const { start, end } = windowFor(month)
                downloadCalendarIcs(start, end).catch((err: unknown) =>
                  toast.error(err instanceof ApiError ? err.message : 'Could not build the calendar file.'),
                )
              }}
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
              onClick={() => stepMonth(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="button"
              onClick={() => goToMonth(currentMonthIso(), todayIso())}
            >
              Today
            </button>
            <button
              type="button"
              className="button"
              aria-label="Next month"
              onClick={() => stepMonth(1)}
            >
              ›
            </button>
            <input
              type="month"
              className="field-input cal-month-input"
              aria-label="Jump to month"
              value={month.slice(0, 7)}
              onChange={(e) => {
                // The box names a month, not a day, so the cursor lands on its first.
                if (ISO_MONTH.test(e.target.value))
                  goToMonth(`${e.target.value}-01`, `${e.target.value}-01`)
              }}
            />
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
        skeleton={{ tiles: { count: 5, row: 'five', className: 'cal-strip' }, cards: [{ span: 12, height: 420 }] }}
      >
        {shown !== null && (
          <>
            <CashflowStrip
              events={visible}
              month={month}
              quoteAsOf={shown.quote_as_of}
              living={shown.living ?? []}
            />
            <div className="card-grid">
              {form !== null && !hasPanel && (
                <section className="card span-12">
                  <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
                  {eventForm}
                </section>
              )}
              <section className="card span-12">
                {view === 'grid' ? (
                  <CalendarGrid
                    month={month}
                    events={visible}
                    today={todayIso()}
                    activeDay={cursorDay}
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
                                  data-event-key={event.key}
                                  data-custom-event-id={event.id ?? undefined}
                                  className={`row-toggle cal-list-item${event.hidden ? ' is-hidden' : ''}${event.done ? ' is-done' : ''}`}
                                  aria-expanded={isOpen}
                                  onClick={() => setOpenListKey(isOpen ? null : key)}
                                >
                                  {event.label}
                                  {event.hidden && <span className="cal-list-detail"> (hidden)</span>}
                                  {amount !== null && (
                                    <span className="cal-list-amount num"> {amount}</span>
                                  )}
                                  {/* The parts' figures; a fold with none (the monthly
                                      reminder's pending parts, spec §T6) is its label alone. */}
                                  {event.items.some((i) => i.amount !== null) && (
                                    <span className="cal-list-detail">
                                      {' — '}
                                      {event.items
                                        .map((i) => `${i.label} ${formatCurrency(i.amount)}`)
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
                <CashflowNotes events={visible} month={month} quoteAsOf={shown.quote_as_of} />
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
      {form !== null && hasPanel && createPortal(eventForm, formHost)}
      {drawerDay !== null && (
        <DayDrawer
          day={drawerDay}
          events={sortForCell(byDate.get(drawerDay) ?? [])}
          onClose={closeDrawer}
          // NOT closeDrawer(): its focusTick pulls the caret back to the grid cell, and the
          // whole point of this button is to land in the form. openAddForm already clears
          // the drawer, and its own tick puts focus on the date field.
          onAddOnDay={openAddForm}
          renderDetails={renderDetails}
        />
      )}
    </div>
  )
}
