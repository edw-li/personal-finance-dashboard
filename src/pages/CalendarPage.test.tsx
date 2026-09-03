import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import ToastProvider from '../components/ToastProvider'
import { calendarEvent } from '../testing/calendarFixtures'
import type { CalendarEvent, CalendarResponse } from '../types/api'
import { formatDate, formatMonth } from '../utils/format'
import { addDays, addMonths, currentMonthIso } from '../utils/months'
import CalendarPage from './CalendarPage'

vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
  createCustomEvent: vi.fn(),
  updateCustomEvent: vi.fn(),
  deleteCustomEvent: vi.fn(),
  putCalendarOverride: vi.fn(),
}))
vi.mock('../utils/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/ics')>()),
  downloadIcs: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
import {
  createCustomEvent,
  deleteCustomEvent,
  fetchCalendar,
  putCalendarOverride,
  updateCustomEvent,
} from '../api/calendar'
import { fetchHousehold } from '../api/household'
import { downloadIcs } from '../utils/ics'

// Wall-clock-proof fixtures: the page boots on the current month, so every date derives
// from the run's real month.
const MONTH = currentMonthIso()
const PREV = addMonths(MONTH, -1)
const NEXT = addMonths(MONTH, 1)
const DAY_15 = `${MONTH.slice(0, 8)}15`
const DAY_16 = `${MONTH.slice(0, 8)}16`
const Q3_KEY = `tax:2026-q3:${DAY_15}`

function fixtureEvents(): CalendarEvent[] {
  return [
    calendarEvent({ date: DAY_16, type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated', items: [{ label: '2025 offer', amount: '41200.00', person_id: null, detail: '50 sh' }] }),
    calendarEvent({ date: DAY_15, type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' }),
    calendarEvent({ date: DAY_15, type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', entity_ref: '2026-q3', amount: '2400.00', direction: 'out', basis: 'estimated' }),
    calendarEvent({ date: DAY_15, type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' }),
    calendarEvent({ date: DAY_15, type: 'custom', label: 'Car insurance', short_label: 'Car insurance', detail: 'policy 8841', id: 41 }),
  ]
}

const SOURCES: CalendarResponse['sources'] = [
  { source: 'rsu', status: 'ok', note: 'valued at the NVDA quote' },
  { source: 'payroll', status: 'ok', note: null },
]

function payload(events = fixtureEvents()): CalendarResponse {
  return { events, sources: SOURCES, quote_as_of: null }
}

function windowFor(monthIso: string): [string, string] {
  return [addMonths(monthIso, -1), addDays(addMonths(monthIso, 2), -1)]
}

function Url() {
  const location = useLocation()
  return <span data-testid="url">{location.pathname + location.search}</span>
}

function renderPage(events: CalendarEvent[] = fixtureEvents(), entry = '/calendar') {
  vi.mocked(fetchCalendar).mockResolvedValue(payload(events))
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <CalendarPage />
                <Url />
              </>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('url').textContent
const cell = (day: string) =>
  document.querySelector(`[role="gridcell"][data-day="${day}"]`) as HTMLElement
const chipIn = (day: string, prefix: string) =>
  Array.from(cell(day).querySelectorAll('button.cal-chip')).find((c) =>
    c.textContent?.startsWith(prefix),
  ) as HTMLElement
const v2Body = { amount: null, direction: 'neutral', recurrence: 'none', until: null }

beforeEach(() => {
  vi.clearAllMocks()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue({
    people: [
      { id: 1, name: 'Ed', is_primary: true },
      { id: 2, name: 'Sam', is_primary: false },
    ],
    marriage_date: null,
  })
  vi.mocked(putCalendarOverride).mockResolvedValue({
    key: Q3_KEY,
    done: true,
    hidden: false,
    note: null,
    amount: null,
  })
})
afterEach(cleanup)

describe('CalendarPage — month, views, grid', () => {
  it('fetches the month ± one and renders the ARIA grid with priced, capped chips', async () => {
    renderPage()
    await screen.findByRole('grid')
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(MONTH))
    expect(chipIn(DAY_16, 'RSU vest').textContent).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(cell(DAY_15).querySelectorAll('button.cal-chip')).toHaveLength(2)
    expect(cell(DAY_15).querySelector('button.cal-more')?.textContent).toBe('+2 more')
    expect(screen.queryByText(/confirmed announcements only/)).toBeNull() // the caveat prose is gone
    expect(screen.getByRole('list', { name: 'Sources' }).textContent).toContain(
      'RSU vests — valued at the NVDA quote',
    )
  })

  it('?month=YYYY-MM drives the fetch; ‹ › and Today write the URL', async () => {
    renderPage(fixtureEvents(), `/calendar?month=${PREV.slice(0, 7)}`)
    await screen.findByRole('grid')
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(PREV))
    expect(screen.getByRole('heading', { name: formatMonth(PREV) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(url()).toBe('/calendar') // the current month is never written
    await waitFor(() => expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(MONTH)))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(url()).toBe(`/calendar?month=${PREV.slice(0, 7)}`)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(url()).toBe('/calendar')
  })

  it('accepts a legacy YYYY-MM-DD month link and the month input jumps', async () => {
    renderPage(fixtureEvents(), `/calendar?month=${PREV}`)
    await screen.findByRole('grid')
    await waitFor(() => expect(url()).toBe(`/calendar?month=${PREV.slice(0, 7)}`))
    fireEvent.change(screen.getByLabelText('Jump to month'), { target: { value: '2027-03' } })
    expect(url()).toBe('/calendar?month=2027-03')
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor('2027-03-01')),
    )
  })

  it('?view=list renders the accessible list with amounts instead of the grid', async () => {
    renderPage(fixtureEvents(), '/calendar?view=list')
    await screen.findByText('Payday')
    expect(screen.queryByRole('grid')).toBeNull()
    const list = document.querySelector('.cal-list') as HTMLElement
    expect(list.textContent).toContain('+$6.8k')
    expect(list.textContent).toContain('2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(url()).toBe('/calendar')
    await screen.findByRole('grid')
  })

  it('the strip totals the visible month', async () => {
    renderPage()
    await screen.findByRole('grid')
    expect(screen.getByRole('group', { name: 'Cash in' }).textContent).toContain('$6,812.44')
    expect(screen.getByRole('group', { name: 'Cash out' }).textContent).toContain('~$2,400.00')
    expect(screen.getByRole('group', { name: 'Vesting' }).textContent).toContain('~$41,200.00')
  })

  it('"+N more" and the day number open the drawer; Escape returns focus to the cell', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(cell(DAY_15).querySelector('button.cal-more') as HTMLElement)
    const dialog = screen.getByRole('dialog', { name: `${formatDate(DAY_15)} — 4 events` })
    expect(dialog.textContent).toContain('Ex-dividend — NVDA')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cell(DAY_15))
    fireEvent.click(screen.getByRole('button', { name: `Open ${formatDate(DAY_16)}` }))
    expect(screen.getByRole('dialog', { name: `${formatDate(DAY_16)} — 1 event` })).toBeTruthy()
  })

  it('"Add event on {day}" leaves the drawer for the FORM, not back onto the grid', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(cell(DAY_15).querySelector('button.cal-more') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: `Add event on ${formatDate(DAY_15)}` }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const date = screen.getByLabelText('Date') as HTMLInputElement
    expect(date.value).toBe(DAY_15)
    // The drawer's Escape hands focus back to the cell; this button must not.
    expect(document.activeElement).toBe(date)
  })

  it('exports the fetched window (Plan E swaps this onto the server renderer)', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar (.ics)' }))
    expect(downloadIcs).toHaveBeenCalledWith(fixtureEvents())
  })

  it('shows the frame error with Retry on a failed first load', async () => {
    vi.mocked(fetchCalendar).mockRejectedValueOnce(new ApiError('calendar down', 500))
    vi.mocked(fetchCalendar).mockResolvedValueOnce(payload())
    render(
      <MemoryRouter>
        <ToastProvider>
          <CalendarPage />
        </ToastProvider>
      </MemoryRouter>,
    )
    // .error-banner, not role="alert": the toast region carries that role too, always.
    expect((await screen.findByText(/calendar down/)).closest('.error-banner')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('grid')
  })
})

describe('CalendarPage — form, arrivals, land-on-save', () => {
  it('?add=1&date= opens the form prefilled and is consumed with a replace', async () => {
    renderPage(fixtureEvents(), `/calendar?add=1&date=${DAY_16}`)
    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy()
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(DAY_16)
    await waitFor(() => expect(url()).toBe('/calendar'))
  })

  it('Add event defaults to the first of the viewed month and posts every v2 field', async () => {
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 99, date: MONTH, label: 'Rent', detail: null, person_id: null, amount: '2400', direction: 'out', recurrence: 'monthly', until: addMonths(MONTH, 3) })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(MONTH)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Rent ' } })
    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '2400' } })
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'out' } })
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('Until (optional)'), {
      target: { value: addMonths(MONTH, 3) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: MONTH,
      label: 'Rent',
      detail: null,
      person_id: null,
      amount: '2400',
      direction: 'out',
      recurrence: 'monthly',
      until: addMonths(MONTH, 3),
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Save event' })).toBeNull()
  })

  it('saving into another month lands the grid there', async () => {
    const day = `${NEXT.slice(0, 8)}10`
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 99, date: day, label: 'Trip', detail: null, person_id: null, amount: null, direction: 'neutral', recurrence: 'none', until: null })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: day } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Trip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(url()).toBe(`/calendar?month=${NEXT.slice(0, 7)}`))
    await waitFor(() => expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(NEXT)))
    expect(cell(day).getAttribute('tabindex')).toBe('0')
  })

  it('Edit prefills from the popover and PATCHes the whole row', async () => {
    vi.mocked(updateCustomEvent).mockResolvedValue({ id: 41, date: DAY_15, label: 'Renewal', detail: 'policy 8841', person_id: null, ...v2Body } as never)
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Car insurance')
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('none')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renewal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateCustomEvent).toHaveBeenCalledWith(41, {
      date: DAY_15,
      label: 'Renewal',
      detail: 'policy 8841',
      person_id: null,
      ...v2Body,
    })
  })

  // Plan A review finding: the edit form used to hard-code amount/direction/recurrence/until
  // to their empty values, so a label tweak on a priced recurring row wiped its money AND
  // its series on the full-replace PATCH. The four fields round-trip through form state.
  it('a label tweak on a priced recurring row keeps its money and its series', async () => {
    const seriesStart = `${PREV.slice(0, 8)}01`
    vi.mocked(updateCustomEvent).mockResolvedValue({ id: 42, date: seriesStart, label: 'Rent (raised)', detail: null, person_id: null, amount: '2400.00', direction: 'out', recurrence: 'monthly', until: null })
    renderPage([
      calendarEvent({ date: DAY_16, type: 'custom', label: 'Rent', short_label: 'Rent', id: 42, amount: '2400.00', direction: 'out', basis: 'confirmed', recurrence: 'monthly', until: null, series_start: seriesStart }),
    ])
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_16, 'Rent'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // A series edits from its START, not from the occurrence that was clicked.
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(seriesStart)
    expect((screen.getByLabelText('Amount (optional)') as HTMLInputElement).value).toBe('$2,400.00')
    expect((screen.getByLabelText('Direction') as HTMLSelectElement).value).toBe('out')
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('monthly')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Rent (raised)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateCustomEvent).toHaveBeenCalledWith(42, {
      date: seriesStart,
      label: 'Rent (raised)',
      detail: null,
      person_id: null,
      amount: '2400.00',
      direction: 'out',
      recurrence: 'monthly',
      until: null,
    })
  })

  it('STRIPS a stamped person suffix before editing', async () => {
    renderPage([
      calendarEvent({ date: DAY_15, type: 'custom', label: 'Dentist — Sam', short_label: 'Dentist — Sam', id: 41, person_id: 2 }),
    ])
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Dentist'))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Dentist')
    expect((screen.getByLabelText('Person') as HTMLSelectElement).value).toBe('2')
  })

  it('Delete offers Undo that re-POSTs the v2 body', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 77, date: DAY_15, label: 'Car insurance', detail: 'policy 8841', person_id: null, ...v2Body } as never)
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteCustomEvent).toHaveBeenCalledWith(41)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: DAY_15,
      label: 'Car insurance',
      detail: 'policy 8841',
      person_id: null,
      ...v2Body,
    })
  })

  // The delete path reports the same way an override does (v1's deliberate choice, kept):
  // a DELETE that failed did not make the month on screen untrue, so the frame's stale line
  // would be blaming the calendar for someone else's failure.
  it('a failed delete toasts and leaves the frame alone', async () => {
    renderPage()
    await screen.findByRole('grid')
    vi.mocked(deleteCustomEvent).mockRejectedValueOnce(new ApiError('delete refused', 409))
    fireEvent.click(chipIn(DAY_15, 'Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect((await screen.findByText('delete refused')).closest('.toast-error')).toBeTruthy()
    expect(document.querySelector('.page-frame-stale')).toBeNull()
  })

  // Plan A review finding: Undo re-POSTed the CLICKED occurrence's date, which re-anchored a
  // deleted series mid-series (a weekly row deleted from its third occurrence came back
  // starting there). The series' own start is what a restore has to send.
  it('Undo restores a series from its start, not from the clicked occurrence', async () => {
    const seriesStart = `${PREV.slice(0, 8)}05`
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 78, date: seriesStart, label: 'Piano lesson', detail: null, person_id: null, amount: '60.00', direction: 'out', recurrence: 'weekly', until: null })
    renderPage([
      calendarEvent({ date: DAY_16, type: 'custom', label: 'Piano lesson', short_label: 'Piano lesson', id: 43, amount: '60.00', direction: 'out', basis: 'confirmed', recurrence: 'weekly', until: null, series_start: seriesStart }),
    ])
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_16, 'Piano lesson'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: seriesStart,
      label: 'Piano lesson',
      detail: null,
      person_id: null,
      amount: '60.00',
      direction: 'out',
      recurrence: 'weekly',
      until: null,
    })
  })
})

describe('CalendarPage — overrides', () => {
  it('Mark done PUTs the full override body and refetches', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Q3 est. tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(putCalendarOverride).toHaveBeenCalledWith(Q3_KEY, {
      done: true,
      hidden: false,
      note: null,
      amount: null,
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
  })

  it('Hide toasts with an Undo that unhides', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Q3 est. tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(putCalendarOverride).toHaveBeenCalledWith(Q3_KEY, {
      done: false,
      hidden: true,
      note: null,
      amount: null,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(putCalendarOverride).toHaveBeenLastCalledWith(Q3_KEY, {
      done: false,
      hidden: false,
      note: null,
      amount: null,
    })
  })

  // A write that failed is not the month's data going stale: the frame's line would blame
  // the calendar for a PUT (house rule — actions report through toasts).
  it('a failed override toasts and leaves the frame alone', async () => {
    renderPage()
    await screen.findByRole('grid')
    vi.mocked(putCalendarOverride).mockRejectedValueOnce(new ApiError('override refused', 409))
    fireEvent.click(chipIn(DAY_15, 'Q3 est. tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect((await screen.findByText('override refused')).closest('.toast-error')).toBeTruthy()
    expect(document.querySelector('.page-frame-stale')).toBeNull()
  })

  it('a hidden event is off the grid but Unhide-able from the list', async () => {
    renderPage([{ ...fixtureEvents()[2], hidden: true }, fixtureEvents()[1]], '/calendar?view=list')
    await screen.findByText('Payday')
    const hiddenRow = screen.getByRole('button', { name: /Tax deadline — Q3/ })
    expect(hiddenRow.classList.contains('is-hidden')).toBe(true)
    fireEvent.click(hiddenRow)
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeTruthy()
  })
})

describe('CalendarPage — snapshot cache', () => {
  it('paints a seeded month instantly and pages to a seen month before its fetch resolves', async () => {
    setSnapshot(`calendar:${MONTH}`, payload())
    setSnapshot(
      `calendar:${NEXT}`,
      payload([
        calendarEvent({ date: `${NEXT.slice(0, 8)}09`, type: 'custom', label: 'Next-month seed', short_label: 'Next-month seed', id: 77 }),
      ]),
    )
    vi.mocked(fetchCalendar).mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter>
        <ToastProvider>
          <CalendarPage />
        </ToastProvider>
      </MemoryRouter>,
    )
    // The top-priority chip of the crowded day — Payday sits behind its "+2 more".
    expect(chipIn(DAY_15, 'Car insurance')).toBeTruthy()
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(MONTH))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await screen.findByRole('heading', { name: formatMonth(NEXT) })
    expect(chipIn(`${NEXT.slice(0, 8)}09`, 'Next-month seed')).toBeTruthy()
    await waitFor(() => expect(fetchCalendar).toHaveBeenCalledTimes(2))
  })
})
