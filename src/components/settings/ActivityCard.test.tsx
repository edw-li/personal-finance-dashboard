import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { ActivityBatch, ActivityPage, ActivityRun } from '../../types/api'
import ToastProvider from '../ToastProvider'
import ActivityCard from './ActivityCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchActivity: vi.fn(),
  fetchActivityRun: vi.fn(),
  undoBatch: vi.fn(),
}))
import { fetchActivity, fetchActivityRun, undoBatch } from '../../api/lifecycle'

const SAVE: ActivityBatch = {
  type: 'batch', batch_id: 'b-1', at: '2026-09-04T09:00:00+00:00', source: 'ui', actor: 'me@example.com',
  label: 'Saved Sep 2026 balances — 19 updated', month: '2026-09-01', rows: 19, undoable: true, undone_by: null,
}
const RESTORE_RUN: ActivityRun = {
  type: 'run', run_id: 7, at: '2026-09-03T23:30:00+00:00', kind: 'restore', ok: true, dry_run: false,
  filename: 'finance-export-20260902-233000.zip', size_bytes: 2_097_152, has_report: true,
}
const IMPORT_RUN: ActivityRun = { ...RESTORE_RUN, run_id: 8, kind: 'import_xlsx', filename: 'finances.xlsx', at: '2026-09-02T09:00:00+00:00' }
const SUMMARY: ActivityBatch = {
  ...SAVE, batch_id: 'b-0', source: 'restore', label: 'Restored snapshot from Sep 2, 2026', rows: 0, undoable: false, at: '2026-09-01T09:00:00+00:00',
}

function page(entries: ActivityPage['entries'], next_before: string | null = null): ActivityPage {
  return { entries, next_before }
}

function mount() {
  return render(
    <ToastProvider>
      <ActivityCard />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchActivity).mockResolvedValue(page([SAVE, RESTORE_RUN, IMPORT_RUN, SUMMARY]))
  vi.mocked(undoBatch).mockResolvedValue({ ...SAVE, batch_id: 'u-1', source: 'undo', label: 'Undid: Saved Sep 2026 balances — 19 updated' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ActivityCard', () => {
  it('lists batches and runs with source pills, and offers Undo only where undoable', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Activity' })).toBeTruthy()
    expect(document.getElementById('activity')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Saved Sep 2026 balances — 19 updated')
    expect(rows[0].querySelector('.activity-source')?.textContent).toBe('ui')
    expect(rows[1].textContent).toContain('Restore · finance-export-20260902-233000.zip')
    expect(rows[3].querySelector('.activity-source')?.textContent).toBe('restore')
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'View report' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('Undo arms on the first click and fires on the second, then toasts and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(undoBatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo?' }))
    await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-1'))
    expect(await screen.findByText('Undone — Saved Sep 2026 balances — 19 updated')).toBeTruthy()
    await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2))
  })

  it('shows a refusal verbatim in the banner', async () => {
    vi.mocked(undoBatch).mockRejectedValue(new ApiError('Later changes touched these rows — undo those first', 409))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo?' }))
    // By TEXT, then by role: ToastProvider keeps an always-mounted assertive region, so
    // findByRole('alert') would resolve on that empty region before the banner arrives.
    const banner = (await screen.findByText('Later changes touched these rows — undo those first'))
      .closest('[role="alert"]')
    expect(banner).not.toBeNull()
  })

  it('View report renders a restore report and an import report through their views', async () => {
    vi.mocked(fetchActivityRun).mockImplementation(async (runId: number) =>
      runId === 7
        ? {
            run: RESTORE_RUN,
            report: {
              dry_run: false, applied: true, exported_at: '2026-09-02T23:30:00+00:00',
              schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
              tables: { accounts: { current: 25, incoming: 25, identical: true } },
              preserved_settings: [], warnings: [], errors: [], restore_point: 'pre-restore-x.zip', batch_id: 'b-0', run_id: 7,
            },
          }
        : {
            run: IMPORT_RUN,
            report: { dry_run: false, applied: true, sheets: { spending: { entities: { transaction: { creates: 2, updates: 0, skips: 0, deletes: 0 } }, warnings: [], errors: [], samples: [], samples_truncated: 0 } } },
          },
    )
    mount()
    const [restoreView, importView] = await screen.findAllByRole('button', { name: 'View report' })
    fireEvent.click(restoreView)
    expect(await screen.findByText('Restored.')).toBeTruthy()
    expect(screen.getByText('1 table unchanged')).toBeTruthy()
    fireEvent.click(importView)
    expect(await screen.findByText('Applied.')).toBeTruthy()
    expect(screen.getByText('transaction')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
    expect(screen.queryByText('Applied.')).toBeNull()
  })

  it('Load more appends the next page using the cursor', async () => {
    vi.mocked(fetchActivity)
      .mockResolvedValueOnce(page([SAVE, RESTORE_RUN], '2026-09-03T23:30:00+00:00'))
      .mockResolvedValueOnce(page([IMPORT_RUN, SUMMARY]))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(4))
    expect(vi.mocked(fetchActivity).mock.calls[1][0]).toBe('2026-09-03T23:30:00+00:00')
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
