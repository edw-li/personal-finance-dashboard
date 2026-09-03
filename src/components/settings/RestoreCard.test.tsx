import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import ToastProvider from '../ToastProvider'
import RestoreCard from './RestoreCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  restoreUpload: vi.fn(),
  restoreStored: vi.fn(),
}))
import { fetchSnapshots, restoreStored, restoreUpload } from '../../api/lifecycle'

// Every date this card shows or asks for is now read off the LOCAL clock (the one the
// select's own rows use), so the file's expectations only mean something with a timezone
// pinned: on a UTC runner they would hold of the server-text slice they exist to replace.
beforeAll(() => vi.stubEnv('TZ', 'America/Los_Angeles'))
afterAll(() => vi.unstubAllEnvs())

const STORED: SnapshotEntry = {
  name: 'finance-export-20260902-233000.zip',
  at: '2026-09-02T23:30:00+00:00',
  size_bytes: 2_097_152,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}

function report(over: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: true,
    applied: false,
    exported_at: '2026-09-02T23:30:00+00:00',
    schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
    tables: {
      accounts: { current: 25, incoming: 25, identical: true },
      account_balances: { current: 800, incoming: 781, identical: false },
    },
    preserved_settings: ['backup_status'],
    warnings: [],
    errors: [],
    restore_point: null,
    batch_id: null,
    run_id: 3,
    ...over,
  }
}

// The second stored file the race needs: a DIFFERENT snapshot, on a different day, so a
// report that belongs to one of them cannot be mistaken for the other's.
const OTHER: SnapshotEntry = {
  name: 'finance-export-20260901-233000.zip',
  at: '2026-09-01T23:30:00+00:00',
  size_bytes: 1_048_576,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}

// The 23:30 PT nightly, whose stamp has already crossed UTC midnight: the select lists it
// as Sep 3, and the server's text says Sep 4.
const NIGHTLY: SnapshotEntry = {
  name: 'finance-export-20260904-0630.zip',
  at: '2026-09-04T06:30:00+00:00',
  size_bytes: 2_097_152,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}

// A promise this file settles by hand — the only way to look at the card while a request
// is still in flight (SettingsPage.test.tsx's helper).
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The URL the card lives under, and the door the Backups card's Restore… link comes
// through: an in-page navigate on an already-mounted card, which is the only shape the
// arrival races can take.
function Probe({ to }: { to: string }) {
  const navigate = useNavigate()
  const { pathname, search, hash } = useLocation()
  return (
    <>
      <div data-testid="location">{pathname + search + hash}</div>
      <button type="button" onClick={() => navigate(to)}>
        arrive
      </button>
    </>
  )
}

function mount(entry = '/settings', arriveTo = '/settings') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <RestoreCard />
        <Probe to={arriveTo} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const confirmSpy = vi.spyOn(window, 'confirm')
const select = () => screen.getByLabelText('Stored snapshot') as HTMLSelectElement
const fileBox = () => screen.getByLabelText('Snapshot file (.zip)') as HTMLInputElement
const url = () => screen.getByTestId('location').textContent
const dateBox = () =>
  screen.getByLabelText("Type the snapshot's date (YYYY-MM-DD) to confirm") as HTMLInputElement
const dryButton = () => screen.getByRole('button', { name: /^dry run/i }) as HTMLButtonElement
const restoreButton = () =>
  screen.getByRole('button', { name: /^restor(e|ing…)$/i }) as HTMLButtonElement
// The card's OWN banner, scoped to it: ToastProvider always mounts an (empty) role="alert"
// live region beside its children, so a bare screen.findByRole('alert') would resolve
// against that one the moment it exists and never see the card's message.
const banner = () => within(screen.getByRole('region', { name: 'Restore' })).findByRole('alert')

beforeEach(() => {
  vi.mocked(fetchSnapshots).mockResolvedValue([STORED])
  vi.mocked(restoreStored).mockResolvedValue(report())
  vi.mocked(restoreUpload).mockResolvedValue(report())
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RestoreCard', () => {
  it('offers the stored snapshots and arms Dry run once one is chosen', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Restore' })).toBeTruthy()
    expect(document.getElementById('restore')).toBeTruthy()
    expect(dryButton().disabled).toBe(true)
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(dryButton().disabled).toBe(false)
    expect(restoreButton().disabled).toBe(true)
  })

  it('dry-runs the stored file, renders the report, and arms Restore only on the typed date', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, true))
    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()
    expect(screen.getByText('account_balances')).toBeTruthy()
    expect(restoreButton().disabled).toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-03' } }) // the wrong day
    expect(restoreButton().disabled).toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(false)
  })

  it('restores after the confirm sentence, toasts, and shows the applied report', async () => {
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(
        report({
          dry_run: false,
          applied: true,
          restore_point: 'pre-restore-20260904-091500-123456.zip',
          batch_id: 'b-1',
        }),
      )
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(confirmSpy).toHaveBeenCalledWith(
      'Restore the snapshot from Sep 2, 2026? A restore point of the current database is written ' +
        'first (kept with the last three), then every exported table is replaced. Other pages ' +
        'reload on their next visit.',
    )
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, false))
    expect(await screen.findByText('Restored.')).toBeTruthy()
    expect(
      screen.getByText('Restore point written: pre-restore-20260904-091500-123456.zip'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Restored snapshot from Sep 2, 2026 — other pages reload on their next visit',
      ),
    ).toBeTruthy()
    // An applied report arms nothing: dry-run again to restore again.
    expect(restoreButton().disabled).toBe(true)
  })

  it('spends no request when the confirm is declined', async () => {
    confirmSpy.mockReturnValue(false)
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(restoreStored).toHaveBeenCalledTimes(1)
  })

  it('uploads a chosen file for the dry run and disarms when the selection changes', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    const file = new File(['zip bytes'], 'finance-export-20260901-1200.zip')
    fireEvent.change(screen.getByLabelText('Snapshot file (.zip)'), { target: { files: [file] } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreUpload).toHaveBeenCalledWith(file, true))
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(false)
    // Picking a stored file instead drops the report and the arm: they described the upload.
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    expect(restoreButton().disabled).toBe(true)
  })

  it('keeps Restore disabled on an incompatible or erroring dry run, and prints the router sentence verbatim', async () => {
    vi.mocked(restoreStored).mockResolvedValueOnce(
      report({
        schema: { snapshot_head: 'b8e4d17c2a90', server_head: 'c3a7e19d5b42', compatible: false },
      }),
    )
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText(/incompatible$/)
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(true)
    vi.mocked(restoreStored).mockRejectedValueOnce(
      new ApiError(
        'This snapshot was exported at schema `b8e4d17c2a90`; this server runs ' +
          '`c3a7e19d5b42`. Restore it on a server at `b8e4d17c2a90`, or use the nightly ' +
          'database dump.',
        409,
      ),
    )
    fireEvent.click(dryButton())
    expect((await banner()).textContent).toContain(
      'This snapshot was exported at schema `b8e4d17c2a90`',
    )
  })

  it('pre-selects a stored snapshot named in the URL and strips the param, anchor intact', async () => {
    mount(`/settings?restore=${encodeURIComponent(STORED.name)}#restore`)
    await waitFor(() => expect(select().value).toBe(STORED.name))
    expect(dryButton().disabled).toBe(false)
    // The COMMAND is consumed; the anchor is not. The page hangs its scroll-and-ring off
    // location.hash, and a strip that dropped it would re-run that effect with nothing to
    // aim at — cancelling the only timer that takes the ring back off.
    await waitFor(() => expect(url()).toBe('/settings#restore'))
  })

  it('refuses a Restore… arrival while a run is in flight, so a report can only arm its own snapshot', async () => {
    vi.mocked(fetchSnapshots).mockResolvedValue([STORED, OTHER])
    const slow = deferred<RestoreReport>()
    vi.mocked(restoreStored).mockReturnValueOnce(slow.promise)
    mount('/settings', `/settings?restore=${encodeURIComponent(OTHER.name)}#restore`)
    await waitFor(() => expect(select().options).toHaveLength(3))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())

    // Mid-flight, the Backups card's link for the OTHER file lands on the page. The dry
    // run owns the card until it answers: the selection must not move under it.
    fireEvent.click(screen.getByRole('button', { name: 'arrive' }))
    expect(select().value).toBe(STORED.name)
    await act(async () => {
      slow.resolve(report())
    })

    // The report that lands is the one that was asked for, and so is everything it arms:
    // its date, the confirm's sentence, and the file the apply actually names.
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restore the snapshot from Sep 2, 2026?'),
    )
    await waitFor(() => expect(restoreStored).toHaveBeenLastCalledWith(STORED.name, false))
  })

  it('looks the list up again when the arrival names a snapshot it has not seen', async () => {
    // "Snapshot now" writes a file into the BACKUPS card's copy of the list; this card
    // still holds the one it fetched at mount, and would judge the new name against it.
    const fresh: SnapshotEntry = {
      ...STORED,
      name: 'finance-export-20260904-091500.zip',
      at: '2026-09-04T09:15:00+00:00',
    }
    vi.mocked(fetchSnapshots)
      .mockResolvedValueOnce([STORED])
      .mockResolvedValueOnce([fresh, STORED])
    mount(`/settings?restore=${encodeURIComponent(fresh.name)}#restore`)
    await waitFor(() => expect(select().value).toBe(fresh.name))
    expect(fetchSnapshots).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(url()).toBe('/settings#restore'))
  })

  it('gives up after one refetch when the name is still unknown, and consumes the param', async () => {
    // Two separate lists, as two real responses are: the second look re-renders the card
    // (and so re-runs the arrival) because the list it hands back is a NEW array, which
    // JSON.parse guarantees and a single shared mock value would not.
    vi.mocked(fetchSnapshots).mockResolvedValueOnce([STORED]).mockResolvedValueOnce([STORED])
    mount('/settings?restore=finance-export-20990101-0000.zip#restore')
    // Held while the second look is in flight, then consumed: an unknown name against a
    // FRESH list is not a snapshot this card can offer, and the param must not loop.
    await waitFor(() => expect(url()).toBe('/settings#restore'))
    expect(fetchSnapshots).toHaveBeenCalledTimes(2)
    expect(select().value).toBe('')
  })

  it('asks for the date the list shows — one local clock, not the server text', async () => {
    vi.mocked(fetchSnapshots).mockResolvedValue([NIGHTLY])
    vi.mocked(restoreStored).mockResolvedValue(report({ exported_at: NIGHTLY.at }))
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    expect(select().options[1].textContent).toContain('Sep 3, 2026, 11:30 PM')
    fireEvent.change(select(), { target: { value: NIGHTLY.name } })
    fireEvent.click(dryButton())
    expect(await screen.findByText(/^Snapshot from Sep 3, 2026 ·/)).toBeTruthy()
    expect(dateBox().placeholder).toBe('2026-09-03')
    // The UTC day the stamp's TEXT reads — the row never said that, so it must not arm.
    fireEvent.change(dateBox(), { target: { value: '2026-09-04' } })
    expect(restoreButton().disabled).toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-03' } })
    expect(restoreButton().disabled).toBe(false)
    fireEvent.click(restoreButton())
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restore the snapshot from Sep 3, 2026?'),
    )
  })

  it('clears the file picker when a stored snapshot is chosen instead', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(fileBox(), { target: { files: [new File(['zip bytes'], 'chosen.zip')] } })
    expect(fileBox().files).toHaveLength(1)
    // The box would otherwise still name a file the card is no longer holding.
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(fileBox().files).toHaveLength(0)
  })

  it('leaves focus on the report after a restore is applied, never on the body', async () => {
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(report({ dry_run: false, applied: true, batch_id: 'b-1' }))
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(await screen.findByText('Restored.')).toBeTruthy()
    // The arm input leaves the tree and the button goes dead the moment the apply lands;
    // focus falls to <body> unless it is put somewhere, and the report is what to read.
    expect(document.activeElement).toBe(
      screen.getByText('Restored.').closest('.import-report')?.parentElement,
    )
  })

  it('drops the standing report when the APPLY fails — nothing has been dry-run against what is there now', async () => {
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockRejectedValueOnce(new ApiError('Restore failed and nothing was changed', 500))
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect((await banner()).textContent).toContain('Restore failed and nothing was changed')
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    expect(restoreButton().disabled).toBe(true)
  })

  it('prints the upload refusals verbatim — the 413 and the 422 alike', async () => {
    vi.mocked(restoreUpload).mockRejectedValueOnce(new ApiError('File too large (max 15 MB)', 413))
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(fileBox(), { target: { files: [new File(['zip bytes'], 'huge.zip')] } })
    fireEvent.click(dryButton())
    expect((await banner()).textContent).toContain('File too large (max 15 MB)')
    vi.mocked(restoreUpload).mockRejectedValueOnce(
      new ApiError('Snapshot is missing table `budget_limits`', 422),
    )
    fireEvent.click(dryButton())
    await waitFor(async () => {
      expect((await banner()).textContent).toContain('Snapshot is missing table `budget_limits`')
    })
  })
})
