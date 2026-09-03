import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/calendarFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/calendarFeed')>()),
  fetchFeedTokens: vi.fn(),
  createFeedToken: vi.fn(),
  revokeFeedToken: vi.fn(),
}))
vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
import { createFeedToken, fetchFeedTokens, revokeFeedToken } from '../../api/calendarFeed'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import ToastProvider from '../ToastProvider'
import CalendarFeedCard from './CalendarFeedCard'

const SETTINGS = {
  swr_pct: '0.040000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
  calendar_update_due_day: 1,
}

function mount() {
  return render(
    <ToastProvider>
      <CalendarFeedCard />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchFeedTokens).mockResolvedValue([
    { id: 1, label: 'phone', created_at: '2026-09-01T10:00:00Z', last_used_at: null },
    { id: 2, label: 'laptop', created_at: '2026-09-02T10:00:00Z', last_used_at: '2026-09-03T08:00:00Z' },
  ])
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
})
afterEach(cleanup)

describe('CalendarFeedCard', () => {
  it('lists the feed links with created and last-used, and the warning sentence', async () => {
    mount()
    expect(await screen.findByText('phone')).toBeTruthy()
    expect(screen.getByText('laptop')).toBeTruthy()
    expect(screen.getAllByText('never')).toHaveLength(1)
    expect(screen.getByText(/Anyone holding a feed link can read your calendar/)).toBeTruthy()
    expect(document.getElementById('calendar')).not.toBeNull()
  })

  it('creates a link, shows its URL exactly once with Copy, and never shows it again', async () => {
    vi.mocked(createFeedToken).mockResolvedValue({
      id: 3,
      label: 'watch',
      created_at: '2026-09-04T10:00:00Z',
      last_used_at: null,
      token: 'tok-abc',
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mount()
    await screen.findByText('phone')
    fireEvent.change(screen.getByLabelText('Label for the new link'), {
      target: { value: ' watch ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'New feed link' }))
    await waitFor(() => expect(createFeedToken).toHaveBeenCalledWith('watch'))
    const url = (await screen.findByLabelText('Feed URL')) as HTMLInputElement
    expect(url.value).toBe(`${window.location.origin}/api/v1/calendar/feed.ics?token=tok-abc`)
    expect(screen.getByText(/shown once/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(url.value)
    // The list refetches; the new row carries no URL.
    vi.mocked(fetchFeedTokens).mockResolvedValue([
      { id: 3, label: 'watch', created_at: '2026-09-04T10:00:00Z', last_used_at: null },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByLabelText('Feed URL')).toBeNull())
    expect(await screen.findByText('watch')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('revokes a link and refetches', async () => {
    vi.mocked(revokeFeedToken).mockResolvedValue(undefined)
    mount()
    await screen.findByText('phone')
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the phone link' }))
    await waitFor(() => expect(revokeFeedToken).toHaveBeenCalledWith(1))
    await waitFor(() => expect(fetchFeedTokens).toHaveBeenCalledTimes(2))
  })

  it('saves the due day with the other settings carried verbatim', async () => {
    vi.mocked(putAppSettings).mockResolvedValue({ ...SETTINGS, calendar_update_due_day: 5 })
    mount()
    const box = (await screen.findByLabelText('Monthly update reminder day')) as HTMLInputElement
    expect(box.value).toBe('1')
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    await waitFor(() =>
      expect(putAppSettings).toHaveBeenCalledWith({
        swr_pct: '0.040000',
        espp_ticker: 'NVDA',
        price_refresh_cron: '10 13 * * mon-fri',
        calendar_update_due_day: 5,
      }),
    )
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('re-reads the settings before the full-form PUT, so a change made elsewhere survives', async () => {
    mount()
    const box = (await screen.findByLabelText('Monthly update reminder day')) as HTMLInputElement
    // The App settings card on this same page saved a new withdrawal rate AFTER this card
    // mounted. The card's own copy is stale; the PUT must carry the current one.
    const moved = { ...SETTINGS, swr_pct: '0.035000' }
    vi.mocked(fetchAppSettings).mockResolvedValue(moved)
    vi.mocked(putAppSettings).mockResolvedValue({ ...moved, calendar_update_due_day: 5 })
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    await waitFor(() =>
      expect(putAppSettings).toHaveBeenCalledWith({
        swr_pct: '0.035000', // NOT the '0.040000' this card mounted with
        espp_ticker: 'NVDA',
        price_refresh_cron: '10 13 * * mon-fri',
        calendar_update_due_day: 5,
      }),
    )
  })

  it('refuses a day outside 1–28 without calling the API', async () => {
    mount()
    const box = await screen.findByLabelText('Monthly update reminder day')
    fireEvent.change(box, { target: { value: '31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    // getAllByRole, not getByRole: ToastProvider mounts a live region of its own, so the
    // card's banner is never the only alert on screen. The message must be ANNOUNCED
    // (role=alert), not merely rendered — hence the role query rather than getByText.
    const announced = screen.getAllByRole('alert').map((el) => el.textContent ?? '')
    expect(announced.join(' ')).toContain('between 1 and 28')
    expect(putAppSettings).not.toHaveBeenCalled()
  })
})
