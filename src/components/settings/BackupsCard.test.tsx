import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { SnapshotEntry } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import ToastProvider from '../ToastProvider'
import BackupsCard from './BackupsCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
}))
vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  downloadSnapshot: vi.fn(),
}))
import { createSnapshot, fetchSnapshots } from '../../api/lifecycle'
import { downloadSnapshot } from '../../api/system'

const NEWEST: SnapshotEntry = {
  name: 'finance-export-20260903-233000.zip',
  at: '2026-09-03T23:30:00+00:00',
  size_bytes: 2_097_152,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}
const FOREIGN: SnapshotEntry = {
  name: 'finance-export-20260902-233000.zip',
  at: '2026-09-02T23:30:00+00:00',
  size_bytes: 1_048_576,
  alembic_head: 'b8e4d17c2a90',
  restorable: false,
}

function mount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BackupsCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

// The card's OWN banner, scoped to it: ToastProvider always mounts an (empty)
// role="alert" live region beside its children, so a bare screen.findByRole('alert')
// resolves against THAT the moment it exists and never sees the card's message — and a
// bare queryByRole('alert') can never be null under a provider either.
const card = () => screen.getByRole('region', { name: 'Backups & snapshots' })
const banner = () => within(card()).findByRole('alert')

beforeEach(() => {
  vi.mocked(fetchSnapshots).mockResolvedValue([NEWEST, FOREIGN])
  vi.mocked(createSnapshot).mockResolvedValue({
    ...NEWEST,
    name: 'finance-export-20260904-091500.zip',
    at: '2026-09-04T09:15:00+00:00',
  })
  vi.mocked(downloadSnapshot).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BackupsCard', () => {
  it('lists the stored snapshots newest first with size and age, and a Restore… link only when restorable', async () => {
    mount()
    expect(screen.getByRole('region', { name: 'Backups & snapshots' })).toBeTruthy()
    expect(document.getElementById('backups')).toBeTruthy()
    // Wait on the ROWS, not on the card: the region and both buttons render on the first
    // pass, before fetchSnapshots resolves, so awaiting them waits for nothing and the
    // sync list query below raced the resolution — it usually won, and lost under a loaded
    // full-suite run (2026-09-03 verification).
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('finance-export-20260903-233000.zip')
    expect(rows[0].textContent).toContain(`${formatDateTime(NEWEST.at)} · 2.0 MB`)
    const restore = screen.getByRole('link', { name: 'Restore…' })
    expect(restore.getAttribute('href')).toBe(
      '/settings?restore=finance-export-20260903-233000.zip#restore',
    )
    // The foreign-schema file is listed (it is on the volume) but offered no restore.
    expect(rows[1].textContent).toContain('different schema — not restorable here')
    expect(screen.getAllByRole('link', { name: 'Restore…' })).toHaveLength(1)
  })

  it('Snapshot now prepends the new entry and toasts its name', async () => {
    mount()
    await screen.findByRole('link', { name: 'Restore…' })
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot now' }))
    expect(screen.getByRole('button', { name: 'Writing…' })).toBeTruthy()
    await waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(1))
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('finance-export-20260904-091500.zip')
    expect(screen.getByText('Snapshot written — finance-export-20260904-091500.zip')).toBeTruthy()
    expect(fetchSnapshots).toHaveBeenCalledTimes(1) // no refetch needed: the POST answers the entry
  })

  it('downloads the export with a busy state, and shows a failure without dropping the list', async () => {
    let release: () => void = () => {}
    vi.mocked(downloadSnapshot).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Download snapshot (.zip)' }))
    expect(
      (screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await act(async () => {
      release()
    })
    expect(
      (screen.getByRole('button', { name: 'Download snapshot (.zip)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    vi.mocked(downloadSnapshot).mockRejectedValue(new ApiError('Export timed out', 0))
    fireEvent.click(screen.getByRole('button', { name: 'Download snapshot (.zip)' }))
    expect((await banner()).textContent).toContain('Export timed out')
    // Same reason as the first test: nothing awaited above is gated on the list arriving.
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the rate-limit sentence verbatim when Snapshot now is refused', async () => {
    vi.mocked(createSnapshot).mockRejectedValue(
      new ApiError('Rate limit exceeded: 10 per 1 minute', 429),
    )
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Snapshot now' }))
    expect((await banner()).textContent).toContain('Rate limit exceeded: 10 per 1 minute')
  })

  it('banners a failed load with Retry, and says so when the volume is empty', async () => {
    vi.mocked(fetchSnapshots)
      .mockRejectedValueOnce(new ApiError('snapshots unavailable', 500))
      .mockResolvedValueOnce([])
    mount()
    expect((await banner()).textContent).toContain('snapshots unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading snapshots' }))
    expect(await screen.findByText(/No stored snapshots yet/)).toBeTruthy()
    expect(within(card()).queryByRole('alert')).toBeNull()
  })
})
