import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import ToastProvider from '../ToastProvider'
import RestoreCard from './RestoreCard'
import { ConfirmProvider } from '../feedback/confirm'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  fetchRestorePoints: vi.fn(),
  restoreUpload: vi.fn(),
  restoreStored: vi.fn(),
}))
import {
  fetchRestorePoints,
  fetchSnapshots,
  restoreStored,
  restoreUpload,
} from '../../api/lifecycle'

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

// A restore point (2026-09-23 spec §B3): written at 16:15 UTC, which is 9:15 AM in Los Angeles.
const POINT: SnapshotEntry = {
  name: 'pre-restore-20260904-161500-123456.zip',
  at: '2026-09-04T16:15:00.123456+00:00',
  size_bytes: 1_572_864,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
  kind: 'restore_point',
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
      <ToastProvider><ConfirmProvider>
        <RestoreCard />
        <Probe to={arriveTo} />
      </ConfirmProvider></ToastProvider>
    </MemoryRouter>,
  )
}

const select = () => screen.getByLabelText('Stored snapshot') as HTMLSelectElement
const fileBox = () => screen.getByLabelText('Snapshot file (.zip)') as HTMLInputElement
const url = () => screen.getByTestId('location').textContent
const dateBox = () => {
  if (screen.queryByRole('alertdialog') === null) fireEvent.click(restoreButton())
  return screen.getByLabelText("Type the snapshot's date (YYYY-MM-DD) to confirm") as HTMLInputElement
}
const dryButton = () => screen.getByRole('button', { name: /^dry run/i }) as HTMLButtonElement
const restoreButton = () =>
  (screen.queryByRole('button', { name: 'Restore snapshot' }) ?? screen.getByRole('button', { name: 'Restore' })) as HTMLButtonElement
// The card's OWN banner, scoped to it: ToastProvider always mounts an (empty) role="alert"
// live region beside its children, so a bare screen.findByRole('alert') would resolve
// against that one the moment it exists and never see the card's message.
const banner = () => within(screen.getByRole('region', { name: 'Restore' })).findByRole('alert')

beforeEach(() => {
  vi.mocked(fetchSnapshots).mockResolvedValue([STORED])
  vi.mocked(fetchRestorePoints).mockResolvedValue([])
  vi.mocked(restoreStored).mockResolvedValue(report())
  vi.mocked(restoreUpload).mockResolvedValue(report())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RestoreCard', () => {
  it('offers restore points in their own group, on the local clock, and dry-runs one by name', async () => {
    vi.mocked(fetchRestorePoints).mockResolvedValue([POINT])
    mount()
    await waitFor(() => expect(select().options).toHaveLength(3))
    expect(Array.from(select().querySelectorAll('optgroup')).map((group) => group.label)).toEqual([
      'Snapshots',
      'Restore points (saved before a restore or import)',
    ])
    const option = select().querySelector('optgroup:last-of-type option') as HTMLOptionElement
    expect(option.textContent).toContain('Sep 4, 2026, 9:15 AM')
    fireEvent.change(select(), { target: { value: POINT.name } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(POINT.name, true))
  })

  it('tells the page an apply wrote a restore point, and re-reads the volume when told', async () => {
    const onStoredChanged = vi.fn()
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(
        report({ dry_run: false, applied: true, restore_point: POINT.name, batch_id: 'b-1' }),
      )
    const view = render(
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider><ConfirmProvider>
          <RestoreCard onStoredChanged={onStoredChanged} />
        </ConfirmProvider></ToastProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    // A dry run writes nothing, so nobody is told anything.
    expect(onStoredChanged).not.toHaveBeenCalled()
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    await screen.findByText('Restored.')
    expect(onStoredChanged).toHaveBeenCalledTimes(1)
    // The page answers with a new revision; the card reads both lists again.
    vi.mocked(fetchRestorePoints).mockResolvedValue([POINT])
    view.rerender(
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider><ConfirmProvider>
          <RestoreCard onStoredChanged={onStoredChanged} revision={1} />
        </ConfirmProvider></ToastProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(select().options).toHaveLength(3))
    // The applied report stands: a re-read of the lists is not a new selection.
    expect(screen.getByText('Restored.')).toBeTruthy()
  })

  it('tells the page after a FAILED apply too — the server saved (and rotated) a point before it failed', async () => {
    // 2026-09-23 lane B1 review, M4: the lists went stale on failure as well, and a stale
    // Restore card would go on offering a point the rotation had already deleted.
    const onStoredChanged = vi.fn()
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockRejectedValueOnce(new ApiError('Restore failed and nothing was changed', 500))
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider><ConfirmProvider>
          <RestoreCard onStoredChanged={onStoredChanged} />
        </ConfirmProvider></ToastProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    expect(onStoredChanged).not.toHaveBeenCalled()
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect((await banner()).textContent).toContain('Restore failed and nothing was changed')
    await waitFor(() => expect(onStoredChanged).toHaveBeenCalledTimes(1))
  })

  it('names the restore point an apply saved, and Roll back… pre-selects it without writing', async () => {
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(
        report({ dry_run: false, applied: true, restore_point: POINT.name, batch_id: 'b-1' }),
      )
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(
      await screen.findByText(/saved as a restore point \(Sep 4, 2026, 9:15 AM\)/),
    ).toBeTruthy()
    // The new point is only on the server until the card looks again.
    vi.mocked(fetchRestorePoints).mockResolvedValue([POINT])
    // "Roll back…", not "Undo": the app's other Undo toasts reverse at once, and this one only
    // opens the way back — a dry run and the typed date still stand between (review M8).
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Roll back…' }))
    await waitFor(() => expect(select().value).toBe(POINT.name))
    await waitFor(() => expect(url()).toBe('/settings#restore'))
    // Pre-selected, never applied: the reader still dry-runs it and types its date.
    expect(restoreStored).toHaveBeenCalledTimes(2)
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('offers the stored snapshots and arms Dry run once one is chosen', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Restore' })).toBeTruthy()
    expect(document.getElementById('restore')).toBeTruthy()
    expect(dryButton().getAttribute('aria-disabled') === 'true').toBe(true)
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(dryButton().getAttribute('aria-disabled') === 'true').toBe(false)
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('dry-runs the stored file, renders the report, and arms Restore only on the typed date', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, true))
    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()
    expect(screen.getByText('account_balances')).toBeTruthy()
    dateBox()
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-03' } }) // the wrong day
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(false)
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
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, false))
    expect(await screen.findByText('Restored.')).toBeTruthy()
    expect(
      screen.getByText('Restore point written: pre-restore-20260904-091500-123456.zip'),
    ).toBeTruthy()
    // The toast names the point the apply saved, on the local clock (09:15 UTC is 2:15 AM
    // in Los Angeles) — the way back, said at the moment it exists.
    expect(
      screen.getByText(
        'Restored snapshot from Sep 2, 2026. The data it replaced is saved as a restore point ' +
          '(Sep 4, 2026, 2:15 AM). Other pages reload on their next visit.',
      ),
    ).toBeTruthy()
    // An applied report arms nothing: dry-run again to restore again.
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('spends no request when the confirm is declined', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
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
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // Picking a stored file instead drops the report and the arm: they described the upload.
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
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
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
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
    expect(dryButton().getAttribute('aria-disabled') === 'true').toBe(false)
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
    dateBox()
    expect(screen.getByRole('alertdialog').textContent).toContain('Restore the snapshot from Sep 3, 2026?')
    // The UTC day the stamp's TEXT reads — the row never said that, so it must not arm.
    fireEvent.change(dateBox(), { target: { value: '2026-09-04' } })
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-03' } })
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(false)
    fireEvent.click(restoreButton())
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
    // focus falls to <body> unless it is put somewhere, and the report is what to read. The
    // card moves it in an effect of the render that shows the report — a scheduler task after
    // the text reaches the DOM — so wait for it rather than reading focus on the same tick.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText('Restored.').closest('.import-report')?.parentElement,
      ),
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
    expect(restoreButton().getAttribute('aria-disabled') === 'true').toBe(true)
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
