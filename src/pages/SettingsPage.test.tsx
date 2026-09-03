import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type {
  AccountOut,
  AppSettingsOut,
  ImportReport,
  ImportSheetReport,
  PersonOut,
  SystemStatus,
} from '../types/api'
import SettingsPage from './SettingsPage'
import { expectInDocumentOrder } from '../testing/domOrder'

// Four api modules, all stubbed. No EChart mock here: this page draws nothing, so the
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
vi.mock('../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
// The three management cards each own a fetch of their own; unmocked, they would make real
// network calls from every test in this file.
vi.mock('../api/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/household')>()),
  fetchHousehold: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  putMarriageDate: vi.fn(),
}))
vi.mock('../api/netWorth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/netWorth')>()),
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}))
vi.mock('../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/spending')>()),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
// AccountsCard's Portfolio-accounts table owns a fetch of its own; unmocked it would make
// a real network call from every test in this file (and banner its failure).
vi.mock('../api/portfolio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/portfolio')>()),
  fetchPortfolioAccounts: vi.fn(),
  patchPortfolioAccount: vi.fn(),
}))
// The Assistant card owns a fetch of its own (2026-09-01 spec §10); unmocked it would make
// a real network call from every test in this file and banner the failure — a SECOND
// "Retry" button on a page whose own retry test asks for that name.
vi.mock('../api/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/assistant')>()),
  fetchAssistantSettings: vi.fn(),
  putAssistantSettings: vi.fn(),
  fetchAssistantModels: vi.fn(),
}))
// LimitsCard owns a mount fetch too, and it was the one card left unmocked: the real
// request rejected on its own schedule, so 'banners a failed load and refetches on Retry'
// intermittently found the card's banner as a second role="alert" (and a second "Retry")
// on cold runs. Its own behaviour is pinned in LimitsCard.test.tsx; this file only needs
// the fetch answered so the card settles.
vi.mock('../api/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/limits')>()),
  fetchLimits: vi.fn(),
  putLimits: vi.fn(),
  cloneLimits: vi.fn(),
}))
// The Backups and Restore cards (2026-09-03 data-lifecycle spec §7–§8) each own a fetch of
// the stored snapshots; unmocked they would hit the network from every test in this file.
vi.mock('../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
  restoreUpload: vi.fn(),
  restoreStored: vi.fn(),
}))
import { fetchSnapshots } from '../api/lifecycle'
import { fetchAssistantSettings } from '../api/assistant'
import { changePassword } from '../api/auth'
import { fetchHousehold } from '../api/household'
import { importXlsx } from '../api/importer'
import { fetchLimits } from '../api/limits'
import { fetchAccounts } from '../api/netWorth'
import { fetchPortfolioAccounts } from '../api/portfolio'
import { fetchAppSettings, putAppSettings } from '../api/settings'
import { fetchCategories } from '../api/spending'
import { fetchSystemStatus } from '../api/system'

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

// Quiet system payload — the card's rendering details are pinned in SystemCard.test.tsx;
// this file only needs the fetch answered so the card settles.
const SYSTEM: SystemStatus = {
  prices: { last: null, next_run_at: null, scheduler_running: false },
  database: { size_bytes: 1024, alembic_head: null },
  backup: null,
  environment: 'dev',
}

// Static copy, pinned verbatim: it is the only place the day-NAMES trap is stated — and
// since the hot-reload landed, the note must NOT resurrect the old restart ritual.
const CRON_HINT =
  '5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applied to the ' +
  'live schedule on save. Must not fire more often than hourly. The Monday run also ' +
  'records the weekly performance point — keep Mondays covered.'
const SAVED_NOTE = 'Saved — the schedule is applied immediately.'

const swrBox = () => screen.getByLabelText('Withdrawal rate (% / year)') as HTMLInputElement
const tickerBox = () => screen.getByLabelText('ESPP ticker') as HTMLInputElement
const cronBox = () => screen.getByLabelText('Price refresh cron') as HTMLInputElement
const currentPwBox = () => screen.getByLabelText('Current password') as HTMLInputElement
const newPwBox = () => screen.getByLabelText('New password') as HTMLInputElement
const confirmPwBox = () => screen.getByLabelText('Confirm new password') as HTMLInputElement
// Named by a prefix that survives the busy label swap ('Save settings' -> 'Saving…',
// 'Change password' -> 'Changing…'), so the in-flight tests can still find the button.
// The password one is ANCHORED at both ends: the card's ⓘ hint is a button whose aria-label
// ("Changes your login password…") is a name too, and a bare /^chang/i now matches both.
// Anchored at BOTH ends, like pwButton and dryButton: the management cards below render
// "Save marriage date", "Save name", "Save account" and "Save category", and a bare
// /^sav/i now matches all of them.
const saveButton = () =>
  screen.getByRole('button', { name: /^sav(e settings|ing…)$/i }) as HTMLButtonElement
const pwButton = () =>
  screen.getByRole('button', { name: /^chang(e password|ing…)$/i }) as HTMLButtonElement
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

const STALE_FILE_HINT = 'If you changed the workbook after choosing it, pick the file again.'
const CLOBBER_WARNING =
  'Apply this workbook to the live database? Sheet values overwrite imported rows — ' +
  'taxes inputs and brackets you edited in the UI for sheet-covered years WILL be ' +
  'reset to the sheet. This cannot be undone.'
const APPLIED_NOTE = 'Other pages load the new data on their next visit.'

const xlsx = (name = 'finances.xlsx') => new File(['xlsx bytes'], name)
const fileBox = () => screen.getByLabelText('Workbook (.xlsx)') as HTMLInputElement
// Prefix-stable like the two above, so the in-flight labels ('Dry run…', 'Applying…')
// answer to the same query as the idle ones. Dry run is anchored at both ends for the same
// reason as pwButton: the card's ⓘ hint aria-label also opens "Dry run …".
// Scoped to the import card: the Restore card below (2026-09-03 data-lifecycle spec §7)
// carries a Dry run button of its own, so a page-wide query now finds two.
const importCard = () => document.getElementById('import') as HTMLElement
const dryButton = () =>
  within(importCard()).getByRole('button', { name: /^dry run…?$/i }) as HTMLButtonElement
const applyButton = () => screen.getByRole('button', { name: /^appl/i }) as HTMLButtonElement
// jsdom has no file picker: the change event carries the File list itself.
const pick = (file: File) => fireEvent.change(fileBox(), { target: { files: [file] } })

// Default "yes" keeps jsdom's unimplemented window.confirm out of every other test in the
// file; only the decline test flips it (BracketsEditor.test.tsx's arrangement).
const confirmSpy = vi.spyOn(window, 'confirm')

const ME: PersonOut = { id: 1, name: 'Me', is_primary: true }
const CHECKING: AccountOut = {
  id: 10,
  name: 'Joint Checking',
  slug: 'joint-checking',
  group: 'cash',
  sort_order: 1,
  is_active: true,
  is_component: false,
  parent_account_id: null,
  person_id: null,
}

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(changePassword).mockResolvedValue(undefined)
  vi.mocked(importXlsx).mockResolvedValue(makeReport())
  vi.mocked(fetchSystemStatus).mockResolvedValue(SYSTEM)
  // Empty volume: the Backups card settles into its own empty note without adding a row,
  // a link or a banner to any of this file's queries.
  vi.mocked(fetchSnapshots).mockResolvedValue([])
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [ME], marriage_date: null })
  vi.mocked(fetchAccounts).mockResolvedValue([CHECKING])
  vi.mocked(fetchPortfolioAccounts).mockResolvedValue([])
  vi.mocked(fetchCategories).mockResolvedValue([])
  // No definitions: the card settles into its (empty) form without adding boxes or a
  // banner to any of this file's queries.
  vi.mocked(fetchLimits).mockResolvedValue({ year: new Date().getFullYear(), items: [] })
  vi.mocked(fetchAssistantSettings).mockResolvedValue({
    key: { configured: true, source: 'env' },
    default_model: 'kimi-k3',
  })
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// A router, always: the page reads location.hash to answer the palette's anchored arrivals
// (/settings#limits), and the app never renders it outside one.
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  )

describe('SettingsPage — app settings', () => {
  it('seeds the boxes from the stored settings, percent-shifted for display', async () => {
    renderPage()
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
    // The balance-suggestions mapping card was removed end to end (spec §5.2 amendment):
    // this page no longer reads accounts or the allocation, and offers no mapping control.
    expect(screen.queryByText(/Balance suggestions/)).toBeNull()
  })

  it('PUTs the full form with the rate shifted back, and notes the hot-applied schedule', async () => {
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
    await screen.findByLabelText('ESPP ticker')

    type(tickerBox(), '$$$')
    fireEvent.click(saveButton())

    // Form-level on purpose: the ticker 422 is NOT field-prefixed (the cron and swr ones
    // are), so there is nothing reliable to map a message onto a box with.
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.queryByText(SAVED_NOTE)).toBeNull()
  })

  it('ghosts the page through the frame while the FIRST load is in flight', async () => {
    const gate = deferred<AppSettingsOut>()
    vi.mocked(fetchAppSettings).mockReturnValue(gate.promise)
    renderPage()

    // The frame owns the title row and the lifecycle now: what used to be a lone "Loading…"
    // paragraph is the skeleton's visually-hidden status line over three ghost cards.
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(document.querySelectorAll('.page-skeleton .card')).toHaveLength(3)
    expect(screen.queryByLabelText('ESPP ticker')).toBeNull()

    gate.resolve(SETTINGS)
    expect(await screen.findByLabelText('ESPP ticker')).toBeTruthy()
    expect(document.querySelector('.page-skeleton')).toBeNull()
  })

  it('offers Retry on the first-failure banner, under a name of its own', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('settings unavailable')
    // Bare: "Showing earlier data" would be a claim about cards that never arrived.
    expect(banner.textContent).not.toContain('Showing earlier data')
    // Named for the fetch it repeats, because the cards below own Retry buttons of their
    // own once they are on screen (SystemCard, Limits, Assistant).
    const retry = screen.getByRole('button', { name: 'Retry loading settings' })
    expect(banner.contains(retry)).toBe(true)
    expect(retry.textContent).toBe('Retry')
  })

  it('banners a failed load and refetches on Retry', async () => {
    const second = deferred<AppSettingsOut>()
    vi.mocked(fetchAppSettings)
      .mockRejectedValueOnce(new ApiError('settings unavailable', 503))
      .mockReturnValue(second.promise)
    renderPage()

    // The frame is ready (the Appearance card needs no network), so the failure arrives as
    // a plain banner above the grid — nothing is on screen for it to be stale over.
    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // A FIRST load that failed knows nothing about the stored settings, and a form seeded
    // with blanks would offer to save them (PortfolioPage's null-holdings rule).
    expect(screen.queryByLabelText('ESPP ticker')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading settings' }))
    // The retry takes the error with it, so the frame drops back to its skeleton: a banner
    // left standing over a page that is trying again says nothing is happening.
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    second.resolve(SETTINGS)
    expect(await screen.findByLabelText('ESPP ticker')).toBeTruthy()
    expect(vi.mocked(fetchAppSettings)).toHaveBeenCalledTimes(2)
    expect(swrBox().value).toBe('4.5')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('SettingsPage — password', () => {
  it('refuses a new/confirm mismatch without spending a request', async () => {
    renderPage()
    await screen.findByLabelText('Current password')

    fillPasswords('old-pw', 'new-pw-12345', 'new-pw-12346')
    fireEvent.click(pwButton())

    expect(await screen.findByText('New passwords do not match.')).toBeTruthy()
    expect(vi.mocked(changePassword)).not.toHaveBeenCalled()
  })

  it('changes the password, clears all three boxes and says so', async () => {
    renderPage()
    await screen.findByLabelText('Current password')

    fillPasswords('old-pw', 'new-pw-12345', 'new-pw-12345')
    fireEvent.click(pwButton())

    await waitFor(() =>
      expect(vi.mocked(changePassword)).toHaveBeenCalledWith('old-pw', 'new-pw-12345'),
    )
    expect(await screen.findByText('Password changed.')).toBeTruthy()
    // What the change actually DOES, said out loud on the page (2026-09-03 shell spec §10):
    // the server bumps token_version, so every other session ends and only this one — which
    // stored the token the response handed back — survives.
    expect(
      screen.getByText('Other devices are signed out; this one stays signed in.'),
    ).toBeTruthy()
    // Nothing typed here may stay on screen after it has been used.
    expect(currentPwBox().value).toBe('')
    expect(newPwBox().value).toBe('')
    expect(confirmPwBox().value).toBe('')
  })

  it('renders a rejected password change verbatim and keeps the boxes', async () => {
    vi.mocked(changePassword).mockRejectedValue(new ApiError('Current password is incorrect', 400))
    renderPage()
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
    renderPage()
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
  it('offers no import card at all when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // The card shares the two forms' `loadedOnce` gate on purpose: a settings GET that
    // failed means the API is unreachable, and an upload card that could only fail —
    // possibly after the user picked a 14 MB workbook — is not worth offering.
    expect(screen.queryByLabelText('Workbook (.xlsx)')).toBeNull()
    expect(screen.queryByRole('button', { name: /^dry run/i })).toBeNull()
  })

  it('arms Dry run with a chosen file, and Apply only with a clean dry-run report', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    renderPage()
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
    renderPage()
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
    // A header row, unlike the plan's headerless skeleton: the glyphs alone say nothing
    // about which of the importer's four verbs a number belongs to.
    expect(screen.getByRole('columnheader', { name: 'Entity' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Unchanged' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Deleted' })).toBeTruthy()
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

  it('lists a sheet whose only content is samples', async () => {
    vi.mocked(importXlsx).mockResolvedValue(
      makeReport({ paycheck: { samples: ['2024-06-14 gross 12500.00 -> 12750.00'] } }),
    )
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    // The fourth arm of the has-content filter: a sheet can change nothing countable and
    // still have something to show. Dropped, its preview lines would vanish silently.
    expect(await screen.findByText('Paycheck')).toBeTruthy()
    // No "(+n more)" when nothing was dropped — the cap is news only when it bit.
    expect(screen.getByText('1 sample changes')).toBeTruthy()
    expect(screen.getByText('2024-06-14 gross 12500.00 -> 12750.00')).toBeTruthy()
    // Samples are not a refusal: a clean sheet with a preview still arms Apply.
    await waitFor(() => expect(applyButton().disabled).toBe(false))
  })

  it('renders sheet errors and leaves Apply disabled', async () => {
    vi.mocked(importXlsx).mockResolvedValue(
      makeReport({ taxes: { errors: ['2024: bracket rows overlap at 100000'] } }),
    )
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    expect(await screen.findByText('ERROR: 2024: bracket rows overlap at 100000')).toBeTruthy()
    // A dry run that found errors is a REFUSAL, not a preview: the same workbook applied
    // would write every sheet that parsed and leave this one half-imported.
    expect(applyButton().disabled).toBe(true)
  })

  it('renders a sheet key the view does not know about', async () => {
    vi.mocked(importXlsx).mockResolvedValue(
      makeReport({ crypto: { errors: ['row 3: unknown symbol "XBT"'] } }),
    )
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    // A tenth backend sheet must not be able to fail INVISIBLY. The card's own error scan
    // walks every key of report.sheets — so a key the view's fixed order has not caught up
    // with would disable Apply with nothing on screen to explain it.
    expect(await screen.findByText('ERROR: row 3: unknown symbol "XBT"')).toBeTruthy()
    // Labelled by its raw key: a guess would be worse than the server's own word.
    expect(screen.getByText('crypto')).toBeTruthy()
    expect(applyButton().disabled).toBe(true)
  })

  it('drops the report when another file is picked', async () => {
    vi.mocked(importXlsx).mockResolvedValue(makeReport(SPENDING_DIFF))
    renderPage()
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
    renderPage()
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
    renderPage()
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
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())

    // The router's own sentence: it names the limit, which no client-side paraphrase does.
    expect(await screen.findByText('File too large (max 15 MB)')).toBeTruthy()
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    // Under every failure: a File is a lazy handle on a disk offset, so re-saving the
    // workbook from Excel invalidates it and the read fails at upload time looking like a
    // network problem. The one cause a message from the server can never name.
    expect(screen.getByText(STALE_FILE_HINT)).toBeTruthy()

    // Anything that is not an ApiError never reached the router, so there is no detail to
    // quote — the card says the one useful thing instead.
    vi.mocked(importXlsx).mockRejectedValue(new TypeError('Failed to fetch'))
    fireEvent.click(dryButton())
    expect(await screen.findByText('Import failed — is the server reachable?')).toBeTruthy()
    expect(screen.queryByText('File too large (max 15 MB)')).toBeNull()
  })

  it('disarms Apply when the apply itself fails — the standing diff is now a guess', async () => {
    vi.mocked(importXlsx)
      .mockResolvedValueOnce(makeReport(SPENDING_DIFF))
      .mockRejectedValueOnce(new ApiError('import failed: database is locked', 500))
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())
    await waitFor(() => expect(applyButton().disabled).toBe(false))
    fireEvent.click(applyButton())

    expect(await screen.findByText('import failed: database is locked')).toBeTruthy()
    // A failed APPLY may still have written — the import is not one transaction. The
    // dry-run diff on screen describes the database as it was BEFORE that half-write, so
    // it is no longer a true preview and must not be left arming Apply for a second pass.
    await waitFor(() => expect(screen.queryByText('Dry run — nothing was written.')).toBeNull())
    expect(screen.queryByText('+2')).toBeNull()
    expect(applyButton().disabled).toBe(true)
    // Recovery is still one click: the file is still chosen, so a fresh dry run says where
    // things actually stand.
    expect(dryButton().disabled).toBe(false)
    expect(fileBox().disabled).toBe(false)
  })

  it('keeps the standing diff when a DRY RUN fails — that pass wrote nothing', async () => {
    vi.mocked(importXlsx)
      .mockResolvedValueOnce(makeReport(SPENDING_DIFF))
      .mockRejectedValueOnce(new ApiError('import failed: sheet "Spending" is missing', 400))
    renderPage()
    await screen.findByLabelText('Workbook (.xlsx)')

    pick(xlsx())
    fireEvent.click(dryButton())
    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()

    fireEvent.click(dryButton())
    expect(await screen.findByText('import failed: sheet "Spending" is missing')).toBeTruthy()

    // The mirror of the failed APPLY above, and the reason that clear is conditional: a dry
    // run writes NOTHING, so the diff already on screen still describes the same database
    // and is still a true preview. Dropping it here would throw away a good answer over a
    // request that changed nothing — and leave Apply disarmed for no reason.
    expect(screen.getByText('Dry run — nothing was written.')).toBeTruthy()
    expect(screen.getByText('+2')).toBeTruthy()
    expect(applyButton().disabled).toBe(false)
    // Every failure carries it, the recoverable ones included.
    expect(screen.getByText(STALE_FILE_HINT)).toBeTruthy()
  })

  it('shuts every import door while a request is in flight', async () => {
    const run = deferred<ImportReport>()
    vi.mocked(importXlsx).mockReturnValue(run.promise)
    renderPage()
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

describe('SettingsPage — system card', () => {
  it('mounts the System card alongside the forms', async () => {
    renderPage()
    await screen.findByText('No refresh recorded yet')
    expect(screen.getByText('No backup recorded')).toBeDefined()
  })

  it('pairs data-out with data-in: System follows Import and precedes the forms (2026-08-31 audit)', async () => {
    renderPage()
    await screen.findByText('No refresh recorded yet')
    const importH = screen.getByRole('heading', { name: /Import workbook/ })
    const system = screen.getByRole('heading', { name: /System/ })
    const appSettings = screen.getByRole('heading', { name: /App settings/ })
    expectInDocumentOrder(importH, system, appSettings)
  })
})

describe('SettingsPage — backups and restore cards', () => {
  it('mounts Backups & snapshots then Restore directly after the System card', async () => {
    renderPage()
    const backups = await screen.findByRole('region', { name: 'Backups & snapshots' })
    const restore = screen.getByRole('region', { name: 'Restore' })
    const system = screen.getByRole('heading', { name: /^System/ }).closest('section')
    expect(system?.nextElementSibling).toBe(backups)
    expect(backups.nextElementSibling).toBe(restore)
    await waitFor(() => expect(vi.mocked(fetchSnapshots)).toHaveBeenCalledTimes(2))
  })

  it('offers neither card when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()
    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Restore' })).toBeNull()
    expect(vi.mocked(fetchSnapshots)).not.toHaveBeenCalled()
  })
})

describe('SettingsPage — appearance card', () => {
  it('mounts the Appearance card directly after the Password card', async () => {
    renderPage()

    const appearance = await screen.findByRole('region', { name: 'Appearance' })
    // DIRECTLY after, not merely somewhere below: appearance closes the pair of cards about
    // this browser and this login, ahead of the management cards that own fetches of their
    // own. Nothing gates it: it sits BETWEEN the page's two loadedOnce blocks, in that seat.
    const password = screen.getByRole('heading', { name: /^Password/ }).closest('section')
    expect(password).not.toBeNull()
    expect(password?.nextElementSibling).toBe(appearance)
  })

  it('keeps the Appearance card when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // It owns no fetch, so it sits OUTSIDE the loadedOnce gate the other cards share: theme
    // and density — and the palette's #appearance jump — still work when the API is
    // unreachable, which is one of the moments a reader most wants the light theme back.
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(document.getElementById('appearance')).not.toBeNull()
    // The cards that DO need the API are still gone.
    expect(screen.queryByLabelText('Workbook (.xlsx)')).toBeNull()
  })
})

describe('SettingsPage — household, accounts and categories cards', () => {
  it('mounts the three management cards and feeds the roster its people', async () => {
    renderPage()

    expect(await screen.findByText('Household')).toBeTruthy()
    expect(screen.getByText('Accounts')).toBeTruthy()
    expect(screen.getByText('Spending categories')).toBeTruthy()

    // The people list is LIFTED out of the Household card so the Accounts owner select is
    // never a render behind it: a partner added above is selectable below without a reload.
    // (Both management tables carry a "Sort order" box, so page-level queries must never
    // reach for that label — the Owner select is unique.)
    await waitFor(() =>
      expect(
        [...(screen.getByLabelText('Owner') as HTMLSelectElement).options].map(
          (o) => o.textContent,
        ),
      ).toEqual(['Joint', 'Me']),
    )
  })

  it('offers none of the three cards when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // They share the import card's `loadedOnce` gate: a settings GET that failed means the
    // API is unreachable, and three cards that could only fail are not worth offering.
    expect(screen.queryByText('Household')).toBeNull()
    expect(screen.queryByText('Accounts')).toBeNull()
    expect(screen.queryByText('Spending categories')).toBeNull()
    expect(vi.mocked(fetchHousehold)).not.toHaveBeenCalled()
  })
})

describe('SettingsPage — assistant card', () => {
  it('mounts the Assistant card last, behind the same loadedOnce gate', async () => {
    renderPage()

    const assistant = await screen.findByRole('region', { name: 'Assistant' })
    // Last on the page on purpose: it configures a side feature, not the dashboard's own
    // numbers, so it sits below the data cards the page exists for.
    expectInDocumentOrder(screen.getByRole('heading', { name: /Contribution limits/ }), assistant)
    await waitFor(() => expect(vi.mocked(fetchAssistantSettings)).toHaveBeenCalledTimes(1))
  })

  it('offers no Assistant card when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Assistant' })).toBeNull()
    expect(vi.mocked(fetchAssistantSettings)).not.toHaveBeenCalled()
  })
})

describe('SettingsPage — anchored arrival from the palette', () => {
  it('scrolls the addressed card into view and rings it for a moment', async () => {
    // jsdom implements no scrollIntoView (HoldingDetailPanel carries the same note), so
    // this stub is both why the call is safe and how the scroll is observed.
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    })
    try {
      render(
        <MemoryRouter initialEntries={['/settings#limits']}>
          <SettingsPage />
        </MemoryRouter>,
      )
      // waitFor from the first tick rather than findBy-then-assert: the ring lives for
      // 1.2 s of WALL clock, and a slow load would otherwise let it expire unobserved.
      // The cards exist only once the first load resolves — the effect waits for that,
      // which is the whole reason the browser's own hash handling cannot do this job.
      await waitFor(() =>
        expect(
          document.getElementById('limits')?.classList.contains('is-highlighted'),
        ).toBe(true),
      )
      expect(scrollIntoView).toHaveBeenCalled()

      // …and the ring is a moment, not a permanent state.
      await waitFor(
        () =>
          expect(
            document.getElementById('limits')?.classList.contains('is-highlighted'),
          ).toBe(false),
        { timeout: 2500 },
      )
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('leaves every card unrung when the URL carries no anchor', async () => {
    renderPage()
    const limits = await screen.findByRole('region', { name: 'Contribution limits' })
    expect(limits.classList.contains('is-highlighted')).toBe(false)
  })
})
