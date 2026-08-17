import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { AppSettingsOut } from '../types/api'
import SettingsPage from './SettingsPage'

// Two api modules, both stubbed. No EChart mock here: this page draws nothing, so the
// house's never-render-echarts-in-jsdom rule has nothing to catch.
vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/settings')>()),
  fetchAppSettings: vi.fn(),
  putAppSettings: vi.fn(),
}))
vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  changePassword: vi.fn(),
}))
import { changePassword } from '../api/auth'
import { fetchAppSettings, putAppSettings } from '../api/settings'

// A promise this file settles by hand — the only way to look at the page while a request
// is still in flight (TaxesPage.test.tsx's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// What the column holds: pydantic serializes Decimal as a JSON STRING, and swr_pct is the
// quantized FRACTION (0.045 = 4.5 % a year).
const SETTINGS: AppSettingsOut = {
  swr_pct: '0.045000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
}

// Static copy, pinned verbatim: it is the only place the two traps behind this box are
// stated (day NAMES, and a cron the scheduler will not read until it reboots).
const CRON_HINT =
  '5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applies after a ' +
  'backend restart. Must not fire more often than hourly.'
const SAVED_NOTE = 'Saved — cron changes apply after a backend restart.'

const swrBox = () => screen.getByLabelText('Withdrawal rate (% / year)') as HTMLInputElement
const tickerBox = () => screen.getByLabelText('ESPP ticker') as HTMLInputElement
const cronBox = () => screen.getByLabelText('Price refresh cron') as HTMLInputElement
const currentPwBox = () => screen.getByLabelText('Current password') as HTMLInputElement
const newPwBox = () => screen.getByLabelText('New password') as HTMLInputElement
const confirmPwBox = () => screen.getByLabelText('Confirm new password') as HTMLInputElement
// Named by a prefix that survives the busy label swap ('Save settings' -> 'Saving…',
// 'Change password' -> 'Changing…'), so the in-flight tests can still find the button.
const saveButton = () => screen.getByRole('button', { name: /^sav/i }) as HTMLButtonElement
const pwButton = () => screen.getByRole('button', { name: /^chang/i }) as HTMLButtonElement
const type = (box: HTMLInputElement, value: string) =>
  fireEvent.change(box, { target: { value } })

function fillPasswords(current: string, next: string, confirm: string) {
  type(currentPwBox(), current)
  type(newPwBox(), next)
  type(confirmPwBox(), confirm)
}

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(changePassword).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsPage — app settings', () => {
  it('seeds the boxes from the stored settings, percent-shifted for display', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('Withdrawal rate (% / year)')

    // The column stores a fraction; the box speaks percent. Number() trims the stored
    // quantizer's trailing zeros ("0.045000" -> 4.5), and the box round-trips through
    // shiftPoint on the way back, so nothing is a float on the wire.
    expect(swrBox().value).toBe('4.5')
    expect(tickerBox().value).toBe('NVDA')
    expect(cronBox().value).toBe('10 13 * * mon-fri')
    expect(screen.getByText(CRON_HINT)).toBeTruthy()
    // The other consequence-bearing hint: an empty box is a real setting (the ESPP page
    // then says so), not a box the user forgot to fill in.
    expect(screen.getByText("Blank = ESPP page shows 'no ticker configured'.")).toBeTruthy()
    expect(vi.mocked(fetchAppSettings)).toHaveBeenCalledTimes(1)
  })

  it('PUTs the full form with the rate shifted back, and notes the restart', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('ESPP ticker')

    type(swrBox(), '3.75')
    // As TYPED: the server owns normalization (it uppercases), and a client that
    // pre-empted it would be a second opinion about the same string.
    type(tickerBox(), 'msft')
    type(cronBox(), '30 14 * * mon-fri')
    fireEvent.click(saveButton())

    await waitFor(() => expect(vi.mocked(putAppSettings)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putAppSettings).mock.calls[0][0]).toEqual({
      swr_pct: '0.0375',
      espp_ticker: 'msft',
      price_refresh_cron: '30 14 * * mon-fri',
    })
    expect(await screen.findByText(SAVED_NOTE)).toBeTruthy()

    // The sentence is about the settings that WERE saved — the next keystroke moves on.
    type(cronBox(), '30 15 * * mon-fri')
    expect(screen.queryByText(SAVED_NOTE)).toBeNull()
  })

  it('sends espp_ticker: null EXPLICITLY when the ticker box is emptied', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('ESPP ticker')

    type(tickerBox(), '   ')
    fireEvent.click(saveButton())

    await waitFor(() => expect(vi.mocked(putAppSettings)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(putAppSettings).mock.calls[0][0]
    // The key must SURVIVE JSON.stringify: an `undefined` value is dropped from the JSON
    // altogether, and `espp_ticker` defaults to None server-side — so "clear the ticker"
    // and "I forgot to send it" would arrive as the same request. Null says it on purpose.
    expect(Object.keys(body)).toContain('espp_ticker')
    expect(body.espp_ticker).toBeNull()
    expect(JSON.parse(JSON.stringify(body)).espp_ticker).toBeNull()
    // The untouched rate rides along, and the load→save round trip must not move it:
    // "0.045000" seeded the box as "4.5" and shiftPoint hands the same value back.
    expect(body.swr_pct).toBe('0.045')
  })

  it('re-saves the inclusive top of the range: 100 % goes back as the fraction 1', async () => {
    vi.mocked(fetchAppSettings).mockResolvedValue({ ...SETTINGS, swr_pct: '1.000000' })
    render(<SettingsPage />)
    await screen.findByLabelText('Withdrawal rate (% / year)')

    // The stored fraction 1 IS 100 %, and the client gate is `n > 100` — inclusive. A row
    // already holding it must be re-savable untouched, or the form would refuse to echo a
    // value the database is currently serving.
    expect(swrBox().value).toBe('100')
    fireEvent.click(saveButton())

    await waitFor(() => expect(vi.mocked(putAppSettings)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putAppSettings).mock.calls[0][0].swr_pct).toBe('1')
  })

  it('re-seeds the boxes from the PUT RESPONSE, not from what was typed', async () => {
    vi.mocked(putAppSettings).mockResolvedValue({
      swr_pct: '0.037500',
      espp_ticker: 'MSFT',
      price_refresh_cron: '30 14 * * mon-fri',
    })
    render(<SettingsPage />)
    await screen.findByLabelText('ESPP ticker')

    type(swrBox(), '3.7500')
    type(tickerBox(), 'msft')
    type(cronBox(), '30 14 * * mon-fri')
    fireEvent.click(saveButton())

    await waitFor(() => expect(vi.mocked(putAppSettings)).toHaveBeenCalledTimes(1))
    // The server echoes what it STORED (quantized rate, uppercased ticker). Keeping the
    // typed text would leave the form reading as unsaved work against values that are
    // already in the database.
    await waitFor(() => expect(swrBox().value).toBe('3.75'))
    expect(tickerBox().value).toBe('MSFT')
    expect(cronBox().value).toBe('30 14 * * mon-fri')
  })

  it('refuses exponent text in the rate box, client-side', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('Withdrawal rate (% / year)')

    // Exponent AND out of range (1e3 is 1000): the two gates disagree about this one box,
    // so the message names which ran FIRST. Only plain-decimal-before-Number() is correct —
    // swapped, the answer would be 'Must be between 0 and 100.'
    type(swrBox(), '1e3')
    fireEvent.click(saveButton())

    // No 422 is behind this gate for the values that matter: shiftPoint hands "1e-3" back
    // untouched and Decimal("1e-3") is a perfectly legal 0.001, so a box that said a
    // thousandth of a percent would be stored as a tenth of one (src/utils/percent.ts).
    expect(await screen.findByText('Enter a plain decimal (no exponents).')).toBeTruthy()
    expect(vi.mocked(putAppSettings)).not.toHaveBeenCalled()

    // Plain notation is converted, not refused — this gate is about the TEXT, not the size.
    type(swrBox(), '0.001')
    fireEvent.click(saveButton())
    await waitFor(() => expect(vi.mocked(putAppSettings)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(putAppSettings).mock.calls[0][0].swr_pct).toBe('0.00001')
  })

  it('refuses a rate outside 0–100 without spending a request', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('Withdrawal rate (% / year)')

    type(swrBox(), '150')
    fireEvent.click(saveButton())

    // The box is labelled in PERCENT, so it says 100 — not the server's "between 0 and 1",
    // which is the stored fraction's vocabulary and would read as the opposite advice.
    expect(await screen.findByText('Must be between 0 and 100.')).toBeTruthy()
    expect(vi.mocked(putAppSettings)).not.toHaveBeenCalled()
  })

  it('renders a PUT rejection verbatim in the form-level error slot', async () => {
    const detail = 'ticker must be 1-20 characters of A-Z, 0-9, dot or dash, starting alphanumeric'
    vi.mocked(putAppSettings).mockRejectedValue(new ApiError(detail, 422))
    render(<SettingsPage />)
    await screen.findByLabelText('ESPP ticker')

    type(tickerBox(), '$$$')
    fireEvent.click(saveButton())

    // Form-level on purpose: the ticker 422 is NOT field-prefixed (the cron and swr ones
    // are), so there is nothing reliable to map a message onto a box with.
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.queryByText(SAVED_NOTE)).toBeNull()
  })

  it('banners a failed load and refetches on Retry', async () => {
    vi.mocked(fetchAppSettings)
      .mockRejectedValueOnce(new ApiError('settings unavailable', 503))
      .mockResolvedValue(SETTINGS)
    render(<SettingsPage />)

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // A FIRST load that failed knows nothing about the stored settings, and a form seeded
    // with blanks would offer to save them (PortfolioPage's null-holdings rule).
    expect(screen.queryByLabelText('ESPP ticker')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('ESPP ticker')).toBeTruthy()
    expect(vi.mocked(fetchAppSettings)).toHaveBeenCalledTimes(2)
    expect(swrBox().value).toBe('4.5')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('SettingsPage — password', () => {
  it('refuses a new/confirm mismatch without spending a request', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('Current password')

    fillPasswords('old-pw', 'new-pw-12345', 'new-pw-12346')
    fireEvent.click(pwButton())

    expect(await screen.findByText('New passwords do not match.')).toBeTruthy()
    expect(vi.mocked(changePassword)).not.toHaveBeenCalled()
  })

  it('changes the password, clears all three boxes and says so', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('Current password')

    fillPasswords('old-pw', 'new-pw-12345', 'new-pw-12345')
    fireEvent.click(pwButton())

    await waitFor(() =>
      expect(vi.mocked(changePassword)).toHaveBeenCalledWith('old-pw', 'new-pw-12345'),
    )
    expect(await screen.findByText('Password changed.')).toBeTruthy()
    // The declared deferral, said out loud on the page: no token rotation, so a stolen
    // session is not what a password change ends (single-user app, 24 h expiry).
    expect(
      screen.getByText('Existing sessions stay signed in until their token expires (~24 h).'),
    ).toBeTruthy()
    // Nothing typed here may stay on screen after it has been used.
    expect(currentPwBox().value).toBe('')
    expect(newPwBox().value).toBe('')
    expect(confirmPwBox().value).toBe('')
  })

  it('renders a rejected password change verbatim and keeps the boxes', async () => {
    vi.mocked(changePassword).mockRejectedValue(new ApiError('Current password is incorrect', 400))
    render(<SettingsPage />)
    await screen.findByLabelText('Current password')

    fillPasswords('wrong-pw', 'new-pw-12345', 'new-pw-12345')
    fireEvent.click(pwButton())

    expect(await screen.findByText('Current password is incorrect')).toBeTruthy()
    // Only a SUCCESS clears: retyping a correct new password to fix a wrong current one
    // would be a punishment for the server's answer.
    expect(newPwBox().value).toBe('new-pw-12345')
    expect(screen.queryByText('Password changed.')).toBeNull()
  })

  it('disables each submit while its OWN request is in flight', async () => {
    const put = deferred<AppSettingsOut>()
    const change = deferred<void>()
    vi.mocked(putAppSettings).mockReturnValue(put.promise)
    vi.mocked(changePassword).mockReturnValue(change.promise)
    render(<SettingsPage />)
    await screen.findByLabelText('Current password')

    fireEvent.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    // Two cards, two flags: a settings save must not lock the password form.
    expect(pwButton().disabled).toBe(false)
    await act(async () => {
      put.resolve(SETTINGS)
    })
    await waitFor(() => expect(saveButton().disabled).toBe(false))

    fillPasswords('old-pw', 'new-pw-12345', 'new-pw-12345')
    fireEvent.click(pwButton())
    await waitFor(() => expect(pwButton().disabled).toBe(true))
    expect(saveButton().disabled).toBe(false)
    await act(async () => {
      change.resolve(undefined)
    })
    await waitFor(() => expect(pwButton().disabled).toBe(false))
  })
})
