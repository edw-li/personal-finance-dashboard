import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { CalendarEvent, CalendarResponse } from '../types/api'
import { addDays, addMonths, currentMonthIso, todayIso } from '../utils/months'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import CalendarPage from './CalendarPage'
import ToastProvider from '../components/ToastProvider'

vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
  createCustomEvent: vi.fn(),
  updateCustomEvent: vi.fn(),
  deleteCustomEvent: vi.fn(),
}))
vi.mock('../utils/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/ics')>()),
  downloadIcs: vi.fn(),
}))
import {
  createCustomEvent,
  deleteCustomEvent,
  fetchCalendar,
  updateCustomEvent,
} from '../api/calendar'
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
      id: null,
    },
    { date: DAY_15, type: 'payday', label: 'Payday', detail: null, href: '/paycheck', id: null },
    {
      date: addDays(DAY_15, 3),
      type: 'ex_dividend',
      label: 'Ex-dividend — NVDA',
      detail: 'NVDA',
      href: '/portfolio',
      id: null,
    },
    {
      date: DAY_15,
      type: 'custom',
      label: 'Car insurance',
      detail: 'policy 8841',
      href: null,
      id: 41,
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
      <ToastProvider>
        <CalendarPage />
      </ToastProvider>
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
  clearSnapshots()
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

  it('places chips on their day — buttons now, a multi-event day carries them all', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const chips = Array.from(grid().querySelectorAll('button.cal-chip'))
    const texts = chips.map((chip) => chip.textContent)
    expect(texts).toContain('RSU vest — 2025 offer')
    expect(texts).toContain('Payday') // same day, second chip
    expect(texts).toContain('Ex-dividend — NVDA')
    expect(texts).toContain('Car insurance')
    const vestChip = chips.find((chip) => chip.textContent === 'RSU vest — 2025 offer')
    // No more direct navigation: chips open the details popover (spec §9.2).
    expect(vestChip?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(vestChip?.getAttribute('aria-expanded')).toBe('false')
    // Colored per the fixed type map — but never color alone: the text IS on the chip.
    expect(vestChip?.getAttribute('style')).toContain('border-left-color')
  })

  it('spaces the sections with the house card-grid wrapper', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    expect(document.querySelector('.card-grid.loading-dim')).not.toBeNull()
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

  it('names all nine event types in the legend, with the cadence/honesty note', async () => {
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
      'Custom',
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

  function chipFor(text: string): HTMLElement {
    const chip = Array.from(grid().querySelectorAll('button.cal-chip')).find(
      (c) => c.textContent === text,
    )
    expect(chip).toBeDefined()
    return chip as HTMLElement
  }

  function popover(): HTMLElement | null {
    return document.querySelector('.cal-popover')
  }

  it('opens a details popover on chip click; Escape closes and refocuses the chip', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    const chip = chipFor('RSU vest — 2025 offer')
    fireEvent.click(chip)
    const dialog = popover()
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.textContent).toContain('25 sh — 2025 offer')
    const link = dialog?.querySelector('a')
    expect(link?.textContent).toBe('Open Comp →')
    expect(link?.getAttribute('href')).toBe('/comp')
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(chip)
  })

  it('keeps one popover at a time and closes on an outside mousedown', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('RSU vest — 2025 offer'))
    fireEvent.mouseDown(chipFor('Payday'))
    fireEvent.click(chipFor('Payday'))
    const dialogs = document.querySelectorAll('.cal-popover')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].textContent).toContain('Open Paycheck →')
    fireEvent.mouseDown(document.body)
    expect(popover()).toBeNull()
  })

  it('custom popover offers Edit/Delete instead of an Open link', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Car insurance'))
    const dialog = popover()
    expect(dialog?.textContent).toContain('policy 8841')
    expect(dialog?.querySelector('a')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
  })

  it('list rows expand the same details inline, closing any grid popover', async () => {
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Payday')) // grid popover open first
    expect(popover()).not.toBeNull()
    const list = document.querySelector('.cal-list') as HTMLElement
    const row = Array.from(list.querySelectorAll('button.cal-list-item')).find((r) =>
      r.textContent?.startsWith('Car insurance'),
    ) as HTMLElement
    fireEvent.click(row)
    const expansion = list.querySelector('.cal-list-expansion')
    expect(expansion).not.toBeNull()
    expect(expansion?.textContent).toContain('Custom')
    expect(expansion?.textContent).toContain('policy 8841')
    expect(popover()).toBeNull() // one open surface at a time — the grid one closed
  })

  it('Add event posts the trimmed form and refetches the window', async () => {
    const todayIsoStr = todayIso()
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 99,
      date: todayIsoStr,
      label: 'Car wash',
      detail: null,
    })
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const dateBox = screen.getByLabelText('Date') as HTMLInputElement
    expect(dateBox.value).toBe(todayIsoStr) // defaults to today
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Car wash ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: todayIsoStr,
      label: 'Car wash',
      detail: null,
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
    // The form closes on success.
    expect(screen.queryByRole('button', { name: 'Save event' })).toBeNull()
  })

  it('Edit prefills the form from the popover and PATCHes the row', async () => {
    vi.mocked(updateCustomEvent).mockResolvedValue({
      id: 41,
      date: DAY_15,
      label: 'Renewal',
      detail: 'policy 8841',
    })
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(popover()).toBeNull() // the popover hands off to the form
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(title.value).toBe('Car insurance')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(DAY_15)
    expect((screen.getByLabelText('Note (optional)') as HTMLInputElement).value).toBe(
      'policy 8841',
    )
    fireEvent.change(title, { target: { value: 'Renewal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateCustomEvent).toHaveBeenCalledWith(41, {
      date: DAY_15,
      label: 'Renewal',
      detail: 'policy 8841',
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
  })

  it('Delete removes the row from the popover and refetches', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteCustomEvent).toHaveBeenCalledWith(41)
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
    expect(popover()).toBeNull()
    // Focus hands off to a stable landmark, not <body> (the unmounted Delete button).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add event' }))
    expect(screen.getByText('Deleted Car insurance')).toBeTruthy()
  })

  it('Undo re-creates the deleted custom event and refetches', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({
      id: 77,
      date: DAY_15,
      label: 'Car insurance',
      detail: 'policy 8841',
    })
    renderPage()
    await screen.findAllByText('RSU vest — 2025 offer')
    fireEvent.click(chipFor('Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: DAY_15,
      label: 'Car insurance',
      detail: 'policy 8841',
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(3))
  })
})

describe('CalendarPage — snapshot cache (2026-08-27 spec §1)', () => {
  /** Renders without arming a resolution: whatever is on screen came from the seed. */
  function renderPending() {
    vi.mocked(fetchCalendar).mockReturnValue(new Promise(() => {}))
    return render(
      <MemoryRouter>
        <ToastProvider>
          <CalendarPage />
        </ToastProvider>
      </MemoryRouter>,
    )
  }

  it('paints the grid instantly from a seeded month and still revalidates', () => {
    setSnapshot(`calendar:${MONTH}`, fixtureEvents())
    renderPending()
    const texts = Array.from(grid().querySelectorAll('button.cal-chip')).map((c) => c.textContent)
    expect(texts).toContain('RSU vest — 2025 offer')
    expect(screen.queryByText('Loading…')).toBeNull()
    const [start, end] = windowFor(MONTH)
    expect(fetchCalendar).toHaveBeenCalledWith(start, end)
  })

  it('pages to an already-seen month and paints it before its fetch resolves', async () => {
    const next = addMonths(MONTH, 1)
    setSnapshot(`calendar:${MONTH}`, fixtureEvents())
    setSnapshot(`calendar:${next}`, [
      {
        date: `${next.slice(0, 8)}09`,
        type: 'custom' as const,
        label: 'Next-month seed',
        detail: null,
        href: null,
        id: 77,
      },
    ])
    renderPending()
    fireEvent.click(screen.getByLabelText('Next month'))
    // No await: the second month's chips are up from ITS key, with its fetch still open.
    const texts = Array.from(grid().querySelectorAll('button.cal-chip')).map((c) => c.textContent)
    expect(texts).toContain('Next-month seed')
    expect(texts).not.toContain('RSU vest — 2025 offer')
    await waitFor(() => expect(fetchCalendar).toHaveBeenCalledTimes(2))
  })

  it('a changed revalidation payload updates the grid', async () => {
    setSnapshot(`calendar:${MONTH}`, fixtureEvents())
    renderPage([
      {
        date: DAY_15,
        type: 'custom' as const,
        label: 'Fresh from the server',
        detail: null,
        href: null,
        id: 99,
      },
    ])
    expect(
      Array.from(grid().querySelectorAll('button.cal-chip')).map((c) => c.textContent),
    ).toContain('RSU vest — 2025 offer')
    await screen.findAllByText('Fresh from the server')
    expect(
      Array.from(grid().querySelectorAll('button.cal-chip')).map((c) => c.textContent),
    ).not.toContain('RSU vest — 2025 offer')
  })
})
