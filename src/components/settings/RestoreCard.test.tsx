import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function mount(entry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <RestoreCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const confirmSpy = vi.spyOn(window, 'confirm')
const select = () => screen.getByLabelText('Stored snapshot') as HTMLSelectElement
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

  it('pre-selects a stored snapshot named in the URL and strips the param', async () => {
    mount(`/settings?restore=${encodeURIComponent(STORED.name)}#restore`)
    await waitFor(() => expect(select().value).toBe(STORED.name))
    expect(dryButton().disabled).toBe(false)
  })
})
