import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { CalendarEvent, CalendarResponse } from '../types/api'
import { addDays, addMonths, currentMonthIso } from '../utils/months'
import CalendarPage from './CalendarPage'

vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
}))
vi.mock('../utils/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/ics')>()),
  downloadIcs: vi.fn(),
}))
import { fetchCalendar } from '../api/calendar'
import { downloadIcs } from '../utils/ics'

// Wall-clock-proof fixtures (OverviewPage.test's NW_MONTHS discipline): the page boots
// on currentMonthIso(), so every fixture date derives from the run's real month.
const MONTH = currentMonthIso()
const DAY_15 = `${MONTH.slice(0, 8)}15`

function fixtureEvents(): CalendarEvent[] {
  return [
    {
      date: DAY_15,
      type: 'rsu_vest',
      label: 'RSU vest — 2025 offer',
      detail: '25 sh — 2025 offer',
      href: '/comp',
    },
    { date: DAY_15, type: 'payday', label: 'Payday', detail: null, href: '/paycheck' },
    {
      date: addDays(DAY_15, 3),
      type: 'ex_dividend',
      label: 'Ex-dividend — NVDA',
      detail: 'NVDA',
      href: '/portfolio',
    },
  ]
}

function windowFor(monthIso: string): [string, string] {
  return [addMonths(monthIso, -1), addDays(addMonths(monthIso, 2), -1)]
}

function renderPage(payload: CalendarEvent[] = fixtureEvents()) {
  vi.mocked(fetchCalendar).mockResolvedValue({ events: payload } satisfies CalendarResponse)
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  )
}

function grid(): HTMLElement {
  const node = document.querySelector('.cal-grid')
  expect(node).not.toBeNull()
  return node as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Manual cleanup, OverviewPage.test's hygiene: vitest runs without injected globals, so
// RTL cannot auto-register afterEach — without this, renders accumulate across tests.
afterEach(cleanup)

describe('CalendarPage', () => {
  it('fetches the 3-month window around the shown month', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const [start, end] = windowFor(MONTH)
    expect(fetchCalendar).toHaveBeenCalledWith(start, end)
  })

  it('places chips on their day — a multi-event day carries them all, linked', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const chips = Array.from(grid().querySelectorAll('a.cal-chip'))
    const texts = chips.map((chip) => chip.textContent)
    expect(texts).toContain('RSU vest — 2025 offer')
    expect(texts).toContain('Payday') // same day, second chip
    expect(texts).toContain('Ex-dividend — NVDA')
    const vestChip = chips.find((chip) => chip.textContent === 'RSU vest — 2025 offer')
    expect(vestChip?.getAttribute('href')).toBe('/comp')
    // Colored per the fixed type map — but never color alone: the text IS on the chip.
    expect(vestChip?.getAttribute('style')).toContain('border-left-color')
  })

  it('renders the accessible date-grouped list for the shown month', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const list = document.querySelector('.cal-list')
    expect(list).not.toBeNull()
    expect(list?.textContent).toContain('RSU vest — 2025 offer')
    expect(list?.textContent).toContain('25 sh — 2025 offer')
    expect(list?.textContent).toContain('Payday')
  })

  it('names all eight event types in the legend, with the cadence/honesty note', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    for (const name of [
      'RSU vest',
      'ESPP purchase',
      'ESPP qualifying date',
      'Ex-dividend',
      'Payday',
      'ESPP offering start',
      'Tax deadline',
      'Monthly update due',
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
    screen.getByText(/semi-monthly \(24 checks\/yr\)/)
    screen.getByText(/confirmed announcements only/)
  })

  it('prev / Today / next refetch the shifted window', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(
        windowFor(addMonths(MONTH, -1)),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(MONTH)),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await waitFor(() =>
      expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(
        windowFor(addMonths(MONTH, 1)),
      ),
    )
  })

  it('shows the empty note when the window has no events', async () => {
    renderPage([])
    await screen.findByText(/No events in this window/)
  })

  it('shows the error banner with a working Retry', async () => {
    vi.mocked(fetchCalendar).mockRejectedValueOnce(new ApiError('calendar down', 500))
    vi.mocked(fetchCalendar).mockResolvedValueOnce({ events: fixtureEvents() })
    render(
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>,
    )
    await screen.findByText(/calendar down/)
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the calendar' }))
    await screen.findAllByText('RSU vest — 2025 offer')
  })

  it('exports the fetched window through downloadIcs', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar (.ics)' }))
    expect(downloadIcs).toHaveBeenCalledWith(fixtureEvents())
  })
})
