import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { SystemStatus } from '../../types/api'

vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn() }))
vi.mock('../../api/prices', () => ({ refreshPrices: vi.fn() }))
import { refreshPrices } from '../../api/prices'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'
import PriceRefreshCard from './PriceRefreshCard'

const SETTINGS = {
  swr_pct: '0.045000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
  calendar_update_due_day: 1,
  espp_discount_pct: '0.150000',
}
const STATUS: SystemStatus = {
  prices: { last: null, next_run_at: '2026-09-07T13:10:00+00:00', scheduler_running: true },
  database: { size_bytes: 1024, alembic_head: null },
  backup: null,
  environment: 'dev',
}

const cronBox = () => screen.getByLabelText('Price refresh cron') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: /^sav(e schedule|ing…)$/i })
const refreshButton = () => screen.getByRole('button', { name: /^refresh(ing…| now)$/i })

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(fetchSystemStatus).mockResolvedValue(STATUS)
  vi.mocked(refreshPrices).mockResolvedValue({
    updated: ['NVDA'],
    failed: {},
    skipped_manual: [],
    duration_ms: 2400,
    dividends_ingested: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PriceRefreshCard', () => {
  it('seeds the cron box and shows the four scheduler facts', async () => {
    render(<PriceRefreshCard />)
    expect(await screen.findByRole('region', { name: 'Price refresh' })).toBeTruthy()
    expect(document.getElementById('price-refresh')).toBeTruthy()
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))
    // The four rows moved off the System card (spec §3.3), beside the schedule that makes them.
    for (const label of ['Last price refresh', 'Next scheduled run', 'Scheduler', 'Recent refreshes']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('No refresh recorded yet')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('saves the cron ALONE and re-reads the facts the save just moved', async () => {
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))

    fireEvent.change(cronBox(), { target: { value: '30 14 * * mon-fri' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    // Nothing but the cron — not even nulls for the fields this card does not show. The server
    // reads the body with exclude_unset, so an absent key keeps its stored value.
    expect(vi.mocked(putAppSettings).mock.calls[0][0]).toEqual({
      price_refresh_cron: '30 14 * * mon-fri',
    })
    expect(await screen.findByText('Saved — the schedule is applied immediately.')).toBeTruthy()
    // The save HOT-APPLIES the schedule, so "Next scheduled run" has just moved.
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
    // The FACTS alone: the box is already re-seeded from the PUT's own response, and a second
    // GET /settings behind every save would only be a second opinion about it.
    expect(fetchAppSettings).toHaveBeenCalledTimes(1)
  })

  it('retires the saved note on the next keystroke', async () => {
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))
    fireEvent.click(saveButton())
    expect(await screen.findByText('Saved — the schedule is applied immediately.')).toBeTruthy()
    fireEvent.change(cronBox(), { target: { value: '30 15 * * mon-fri' } })
    expect(screen.queryByText('Saved — the schedule is applied immediately.')).toBeNull()
  })

  it('runs a refresh, reports what it did and re-reads the facts', async () => {
    render(<PriceRefreshCard />)
    await screen.findByText('Next scheduled run')

    fireEvent.click(refreshButton())

    await waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(1))
    // The Portfolio page's own sentence, from the shared hook.
    expect(await screen.findByText(/1 updated in 2s/)).toBeTruthy()
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
    expect(fetchAppSettings).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(refreshButton().hasAttribute('disabled')).toBe(false))
  })

  it('leaves a half-typed cron alone when Refresh now re-reads the facts', async () => {
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))

    fireEvent.change(cronBox(), { target: { value: '30 15 * * mon-fri' } })
    fireEvent.click(refreshButton())

    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
    // A refresh re-reads the FACTS, not the settings: re-seeding the box from the stored cron
    // would throw away an expression the reader is in the middle of writing.
    expect(cronBox().value).toBe('30 15 * * mon-fri')
    expect(putAppSettings).not.toHaveBeenCalled()
  })

  it('holds Refresh now disabled until the fresh facts are on screen', async () => {
    let settle: (value: SystemStatus) => void = () => {}
    render(<PriceRefreshCard />)
    await screen.findByText('Next scheduled run')

    vi.mocked(fetchSystemStatus).mockReturnValue(
      new Promise<SystemStatus>((resolve) => {
        settle = resolve
      }),
    )
    fireEvent.click(refreshButton())

    // The prices are in, but the numbers beside the button still describe the run BEFORE it.
    await waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
    expect(refreshButton().hasAttribute('disabled')).toBe(true)

    await act(async () => {
      settle({ ...STATUS, prices: { ...STATUS.prices, scheduler_running: false } })
    })
    await waitFor(() => expect(refreshButton().hasAttribute('disabled')).toBe(false))
    expect(screen.getByText('Not running')).toBeTruthy()
  })

  it('renders a refused save and a failed refresh verbatim', async () => {
    vi.mocked(putAppSettings).mockRejectedValue(
      new ApiError('cron must not fire more often than hourly', 422),
    )
    vi.mocked(refreshPrices).mockRejectedValue(new ApiError('provider unavailable', 502))
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))

    fireEvent.click(saveButton())
    expect(await screen.findByText('cron must not fire more often than hourly')).toBeTruthy()
    expect(screen.queryByText('Saved — the schedule is applied immediately.')).toBeNull()

    fireEvent.click(refreshButton())
    expect(await screen.findByText('provider unavailable')).toBeTruthy()
  })

  it('banners a failed load and refetches on Retry', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new ApiError('status unavailable', 503))
    render(<PriceRefreshCard />)

    expect(await screen.findByText('status unavailable')).toBeTruthy()
    expect(screen.queryByText('Next scheduled run')).toBeNull()

    vi.mocked(fetchSystemStatus).mockResolvedValue(STATUS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the refresh schedule' }))
    expect(await screen.findByText('Next scheduled run')).toBeTruthy()
  })
})
