import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { LastRefresh, SystemStatus } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import SystemCard from './SystemCard'

vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
import { fetchSystemStatus } from '../../api/system'

const LAST_RUN: LastRefresh = {
  at: '2026-08-24T20:11:00+00:00',
  trigger: 'scheduled',
  updated: 36,
  failed: {},
  skipped_manual: 1,
  history_appended: true,
  dividends_ingested: 0,
  dividends_removed: 0,
  dividends_skipped_overlap: 0,
}

// Backup ages are wall-clock relative (backupAge defaults to `new Date()`), so the
// fixtures are computed from the run's own now — a hard-coded stamp would go amber two
// days after it was written and take this file down with it (OverviewPage.test's rule).
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

function backupOut(hoursBack: number) {
  return {
    last_success_at: hoursAgo(hoursBack),
    object_key: 'backups/finance_2026-08-25.sql.gz',
    size: '1.2M',
  }
}

function systemOut(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    prices: { last: LAST_RUN, next_run_at: '2026-08-25T20:10:00+00:00', scheduler_running: true },
    database: { size_bytes: 123_456_789, alembic_head: 'e7c5a9f4b2d8' },
    backup: backupOut(10),
    environment: 'prod',
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('renders the healthy rows verbatim', async () => {
  const backup = backupOut(10)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  // The refresh line wears PortfolioPage's refresh-status-line vocabulary — the two
  // surfaces describe the same stored run and must read the same.
  await screen.findByText(`${formatDateTime(LAST_RUN.at)} (scheduled) · 36 updated`)
  expect(screen.getByText(formatDateTime('2026-08-25T20:10:00+00:00'))).toBeDefined()
  expect(screen.getByText('Running')).toBeDefined()
  const stamp = screen.getByText(`${formatDateTime(backup.last_success_at)} · 1.2M`)
  expect(stamp.className).toBe('')
  expect(screen.getByText('117.7 MB')).toBeDefined()
  expect(screen.getByText('e7c5a9f4b2d8')).toBeDefined()
  expect(screen.getByText('prod')).toBeDefined()
})

it('appends the failed count to the refresh line only when nonzero', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      prices: {
        last: { ...LAST_RUN, failed: { ZI: 'delisted' } },
        next_run_at: null,
        scheduler_running: true,
      },
    }),
  )
  render(<SystemCard />)
  await screen.findByText(`${formatDateTime(LAST_RUN.at)} (scheduled) · 36 updated · 1 failed`)
})

it('tones the backup amber past 48 hours, wording unchanged', async () => {
  const backup = backupOut(72)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(`${formatDateTime(backup.last_success_at)} · 1.2M`)
  expect(stamp.className).toBe('system-stale')
})

it('changes the WORDING past seven days, not colour alone', async () => {
  const backup = backupOut(8 * 24)
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} · 1.2M — more than a week old`,
  )
  expect(stamp.className).toBe('system-overdue')
})

it('renders the quiet states: no run, no schedule, no backup, no alembic table', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      prices: { last: null, next_run_at: null, scheduler_running: false },
      database: { size_bytes: 1024, alembic_head: null },
      backup: null,
      environment: 'dev',
    }),
  )
  render(<SystemCard />)
  await screen.findByText('No refresh recorded yet')
  expect(screen.getByText('Not scheduled')).toBeDefined()
  expect(screen.getByText('Not running')).toBeDefined()
  expect(screen.getByText('No backup recorded')).toBeDefined()
  expect(screen.getByText('1.0 KB')).toBeDefined()
  // Alembic head plus the two empty run trails all render the dash.
  expect(screen.getAllByText('—')).toHaveLength(3)
  expect(screen.getByText('dev')).toBeDefined()
})

it('shows the load failure verbatim and retries into the rows', async () => {
  vi.mocked(fetchSystemStatus).mockRejectedValueOnce(new ApiError('status unavailable', 500))
  render(<SystemCard />)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('status unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Running')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('renders the last-5 run trails compactly', async () => {
  vi.mocked(fetchSystemStatus).mockResolvedValue(
    systemOut({
      backup_runs: [
        { at: '2026-08-30T03:00:00+00:00', ok: true, object: 'backups/finance.sql.gz.gpg' },
        { at: '2026-08-29T03:00:00+00:00', ok: false, error: 'pg_dump: connection refused' },
      ],
      refresh_runs: [
        { at: '2026-08-30T20:10:00+00:00', trigger: 'scheduled', updated: 36, failed_count: 2 },
        { at: '2026-08-29T20:10:00+00:00', trigger: 'manual', updated: 40, failed_count: 0 },
      ],
    }),
  )
  render(<SystemCard />)
  await screen.findByText(
    `${formatDateTime('2026-08-30T03:00:00+00:00')} ok · ` +
      `${formatDateTime('2026-08-29T03:00:00+00:00')} failed`,
  )
  expect(
    screen.getByText(
      `${formatDateTime('2026-08-30T20:10:00+00:00')} 36 updated, 2 failed · ` +
        `${formatDateTime('2026-08-29T20:10:00+00:00')} 40 updated`,
    ),
  ).toBeDefined()
})

// The verify phase (2026-09-03 data-lifecycle spec §8): "Last backup" now means "the dump
// restores", and the row says so in words.
it('reads a verified, encrypted marker as words, bytes from size_bytes', async () => {
  const backup = {
    ...backupOut(10),
    size_bytes: 110_592,
    encrypted: true,
    retention_days: 30,
    verified: true,
    verified_at: hoursAgo(10),
    row_counts: { net_worth_snapshots: 33, monthly_spending: 621, position_transactions: 210 },
  }
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} · 108.0 KB · encrypted · verified`,
  )
  expect(stamp.className).toBe('')
  expect(screen.queryByRole('button', { name: 'Download snapshot (.zip)' })).toBeNull()
})

it('says NOT verified with the reason, in the overdue tone — colour is never the only channel', async () => {
  const backup = {
    ...backupOut(10),
    size_bytes: 110_592,
    encrypted: true,
    verified: false,
    verify_error: 'row count mismatch: live monthly_spending=621 vs restored monthly_spending=600',
  }
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} · 108.0 KB · encrypted · not verified — ` +
      'row count mismatch: live monthly_spending=621 vs restored monthly_spending=600',
  )
  expect(stamp.className).toBe('system-overdue')
})
