import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { AppSettingsOut, ImportReport, ImportSheetReport } from '../types/api'
import SettingsPage from './SettingsPage'

// Three api modules, all stubbed. No EChart mock here: this page draws nothing, so the
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
vi.mock('../api/importer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/importer')>()),
  importXlsx: vi.fn(),
}))
import { changePassword } from '../api/auth'
import { importXlsx } from '../api/importer'
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

// --- import card ---

// The nine keys report.SHEET_KEYS always sends — every sheet is present even when clean,
// which is exactly what the card's "list only what changed" filter has to survive.
const SHEET_KEYS = [
  'reference_data',
  'positions',
  'portfolio',
  'net_worth',
  'spending',
  'taxes',
  'espp',
  'paycheck',
  'focal_history',
] as const

const CLEAN_SHEET: ImportSheetReport = {
  entities: {},
  warnings: [],
  errors: [],
  samples: [],
  samples_truncated: 0,
}

// `applied` picks the pair the server sends together: a dry run is (dry_run, !applied) and
// a real one is (!dry_run, applied) — the card arms Apply off the FORMER only.
function makeReport(
  patches: Record<string, Partial<ImportSheetReport>> = {},
  applied = false,
): ImportReport {
  const sheets: Record<string, ImportSheetReport> = {}
  for (const key of SHEET_KEYS) sheets[key] = { ...CLEAN_SHEET }
  for (const [key, patch] of Object.entries(patches)) sheets[key] = { ...CLEAN_SHEET, ...patch }
  return { dry_run: !applied, applied, sheets }
}

const SPENDING_DIFF = {
  spending: {
    entities: { transaction: { creates: 2, updates: 1, skips: 3, deletes: 0 } },
    warnings: ['row 12: unmapped category "Misc"'],
    samples: ['2024-03-02 Groceries 84.20 -> 84.02', '2024-03-05 new: Gas 51.00'],
    samples_truncated: 7,
  },
}

const CLOBBER_WARNING =
  'Apply this workbook to the live database? Sheet values overwrite imported rows — ' +
  'taxes inputs and brackets you edited in the UI for sheet-covered years WILL be ' +
  'reset to the sheet. This cannot be undone.'
const APPLIED_NOTE = 'Other pages load the new data on their next visit.'

const xlsx = (name = 'finances.xlsx') => new File(['xlsx bytes'], name)
const fileBox = () => screen.getByLabelText('Workbook (.xlsx)') as HTMLInputElement
// Prefix-stable like the two above, so the in-flight labels ('Dry run…', 'Applying…')
// answer to the same query as the idle ones.
const dryButton = () => screen.getByRole('button', { name: /^dry run/i }) as HTMLButtonElement
const applyButton = () => screen.getByRole('button', { name: /^appl/i }) as HTMLButtonElement
// jsdom has no file picker: the change event carries the File list itself.
const pick = (file: File) => fireEvent.change(fileBox(), { target: { files: [file] } })

// Default "yes" keeps jsdom's unimplemented window.confirm out of every other test in the
// file; only the decline test flips it (BracketsEditor.test.tsx's arrangement).
const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(changePassword).mockResolvedValue(undefined)
  vi.mocked(importXlsx).mockResolvedValue(makeReport())
  confirmSpy.mockReturnValue(true)
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

describe('SettingsPage — xlsx import', () => {
  it('arms Dry run with a chosen file, and Apply only with a clean dry-run report', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    expect(dryButton().disabled).toBe(true)
    expect(applyButton().disabled).toBe(true)

    pick(xlsx())
    expect(dryButton().disabled).toBe(false)
    // A file is not a permission: Apply waits on a REPORT, so nothing reaches the live
    // database that has not been parsed and shown to the user first.
    expect(applyButton().disabled).toBe(true)

    fireEvent.click(dryButton())
    await waitFor(() => expect(applyButton().disabled).toBe(false))
  })

  it('dry-runs the chosen file and renders the per-sheet diff', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    const file = xlsx()
    pick(file)
    fireEvent.click(dryButton())

    await waitFor(() => expect(vi.mocked(importXlsx)).toHaveBeenCalledTimes(1))
    // The File object itself, dry-run flag ON. The server keeps nothing between the two
    // calls, so the same File is what Apply will upload again.
    expect(vi.mocked(importXlsx).mock.calls[0]).toEqual([file, true])

    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()
    expect(screen.getByText('Spending')).toBeTruthy()
    expect(screen.getByText('transaction')).toBeTruthy()
    // creates / updates / skips / deletes, each in its own cell.
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByText('~1')).toBeTruthy()
    expect(screen.getByText('=3')).toBeTruthy()
    expect(screen.getByText('−0')).toBeTruthy()
    expect(screen.getByText('WARN: row 12: unmapped category "Misc"')).toBeTruthy()
    // The server sends a capped sample list plus how many it dropped; the summary has to
    // say both, or a 2-line preview would read as the whole change.
    expect(screen.getByText('2 sample changes (+7 more)')).toBeTruthy()
    expect(screen.getByText('2024-03-05 new: Gas 51.00')).toBeTruthy()
    // All nine sheets come back on every report; the eight that changed nothing are not
    // headings — a wall of empty sections would bury the one that did.
    expect(screen.queryByText('Paycheck')).toBeNull()
    expect(screen.queryByText(APPLIED_NOTE)).toBeNull()
  })

  it('renders sheet errors and leaves Apply disabled', async () => {
    vi.mocked(importXlsx).mockResolvedValue(
      makeReport({ taxes: { errors: ['2024: bracket rows overlap at 100000'] } }),
    )
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    expect(await screen.findByText('ERROR: 2024: bracket rows overlap at 100000')).toBeTruthy()
    // A dry run that found errors is a REFUSAL, not a preview: the same workbook applied
    // would write every sheet that parsed and leave this one half-imported.
    expect(applyButton().disabled).toBe(true)
  })

  it('drops the report when another file is picked', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())
    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()

    pick(xlsx('last-week.xlsx'))
    // The report described exactly one workbook. Left on screen it would be a diff of the
    // OLD file arming Apply for the new one.
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    expect(screen.queryByText('+2')).toBeNull()
    expect(applyButton().disabled).toBe(true)
  })

  it('spends no request when the clobber warning is declined', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    confirmSpy.mockReturnValue(false)
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())
    await waitFor(() => expect(applyButton().disabled).toBe(false))
    fireEvent.click(applyButton())

    expect(confirmSpy).toHaveBeenCalledWith(CLOBBER_WARNING)
    // One call: the dry run. "No" means nothing was uploaded a second time.
    expect(vi.mocked(importXlsx)).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Applied.')).toBeNull()
  })

  it('applies the same file once the clobber warning is accepted', async () => {
    vi.mocked(importXlsx)
      .mockResolvedValueOnce(makeReport(SPENDING_DIFF))
      .mockResolvedValueOnce(makeReport(SPENDING_DIFF, true))
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    const file = xlsx()
    pick(file)
    fireEvent.click(dryButton())
    await waitFor(() => expect(applyButton().disabled).toBe(false))
    fireEvent.click(applyButton())

    // The sentence names the one thing a dry run cannot show: sheet-covered years win, so
    // taxes work done in the UI for those years is gone after this.
    expect(confirmSpy).toHaveBeenCalledWith(CLOBBER_WARNING)
    await waitFor(() => expect(vi.mocked(importXlsx)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(importXlsx).mock.calls[1]).toEqual([file, false])

    expect(await screen.findByText('Applied.')).toBeTruthy()
    expect(screen.getByText(APPLIED_NOTE)).toBeTruthy()
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    // An applied report arms nothing: applying the same workbook twice means dry-running
    // it again, which is also the only way to see what the second pass would do.
    expect(applyButton().disabled).toBe(true)
  })

  it('renders a refused upload verbatim in the card error slot', async () => {
    vi.mocked(importXlsx).mockRejectedValue(new ApiError('File too large (max 15 MB)', 413))
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    // The router's own sentence: it names the limit, which no client-side paraphrase does.
    expect(await screen.findByText('File too large (max 15 MB)')).toBeTruthy()
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()

    // Anything that is not an ApiError never reached the router, so there is no detail to
    // quote — the card says the one useful thing instead.
    vi.mocked(importXlsx).mockRejectedValue(new TypeError('Failed to fetch'))
    fireEvent.click(dryButton())
    expect(await screen.findByText('Import failed — is the server reachable?')).toBeTruthy()
    expect(screen.queryByText('File too large (max 15 MB)')).toBeNull()
  })

  it('shuts every import door while a request is in flight', async () => {
    const run = deferred<ImportReport>()
    vi.mocked(importXlsx).mockReturnValue(run.promise)
    render(<SettingsPage />)
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    await waitFor(() => expect(dryButton().disabled).toBe(true))
    // Both buttons AND the file input: with all three shut there is no way to start a
    // second upload behind the first, which is what buys this card its missing seq guard.
    expect(applyButton().disabled).toBe(true)
    expect(fileBox().disabled).toBe(true)
    // Three cards, three flags — an import must not lock the two forms above it.
    expect(saveButton().disabled).toBe(false)
    expect(pwButton().disabled).toBe(false)

    await act(async () => {
      run.resolve(makeReport(SPENDING_DIFF))
    })
    await waitFor(() => expect(dryButton().disabled).toBe(false))
    expect(fileBox().disabled).toBe(false)
  })
})
