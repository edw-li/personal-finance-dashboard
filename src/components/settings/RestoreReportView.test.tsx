import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RestoreReport } from '../../types/api'
import RestoreReportView from './RestoreReportView'

afterEach(cleanup)

// The schema line dates an INSTANT, and it does so on the local clock (the one the Restore
// card's select and its arm box read) — so the expectations below only mean something with
// a timezone pinned.
beforeAll(() => vi.stubEnv('TZ', 'America/Los_Angeles'))
afterAll(() => vi.unstubAllEnvs())

function report(over: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: true,
    applied: false,
    exported_at: '2026-09-02T23:30:00+00:00',
    schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
    tables: {
      accounts: { current: 25, incoming: 25, identical: true },
      account_balances: { current: 800, incoming: 781, identical: false },
      monthly_spending: { current: 640, incoming: 621, identical: false },
      people: { current: 2, incoming: 2, identical: true },
    },
    preserved_settings: ['backup_status', 'backup_runs'],
    warnings: [],
    errors: [],
    restore_point: null,
    batch_id: null,
    run_id: 12,
    ...over,
  }
}

describe('RestoreReportView', () => {
  it('lists the differing tables first and folds the identical ones under one summary', () => {
    render(<RestoreReportView report={report()} />)
    expect(screen.getByRole('status').textContent).toBe('Dry run — nothing was written.')
    const rows = screen.getAllByRole('row').slice(1) as HTMLTableRowElement[] // minus the header
    expect(rows.map((r) => r.cells[0].textContent)).toEqual([
      'account_balances',
      'monthly_spending',
    ])
    expect(rows[0].cells[1].textContent).toBe('800')
    expect(rows[0].cells[2].textContent).toBe('781')
    const fold = screen.getByText('2 tables unchanged')
    // The plan's Step-4 rider: jsdom keeps a closed <details>'s children in the DOM and
    // getByText finds them regardless, so the FOLD ITSELF is what the state assertion reads.
    const details = fold.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    fireEvent.click(fold)
    expect(details.open).toBe(true)
    // …and the folded rows are the identical ones, with their (unchanged) row counts.
    expect(screen.getByText('accounts (25)')).toBeTruthy()
    expect(screen.getByText('people (2)')).toBeTruthy()
  })

  it('prints the schema line, the preserved settings and the snapshot date', () => {
    render(<RestoreReportView report={report()} />)
    expect(
      screen.getByText(
        'Snapshot from Sep 2, 2026 · schema c3a7e19d5b42 · this server c3a7e19d5b42 · compatible',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Kept from this server: backup_status, backup_runs')).toBeTruthy()
  })

  it('dates the snapshot on the local clock, not on the stamp’s UTC text', () => {
    // The 23:30 PT nightly, stamped 06:30 the next morning in UTC: the Restore card lists
    // it as Sep 3 and asks for 2026-09-03 to be typed, so this line has to agree.
    render(<RestoreReportView report={report({ exported_at: '2026-09-04T06:30:00+00:00' })} />)
    expect(screen.getByText(/^Snapshot from Sep 3, 2026 ·/)).toBeTruthy()
  })

  it('says incompatible in words and renders warnings and errors', () => {
    render(
      <RestoreReportView
        report={report({
          schema: { snapshot_head: 'b8e4d17c2a90', server_head: 'c3a7e19d5b42', compatible: false },
          warnings: ['accounts.person_id is absent from the snapshot — the column default applies'],
          errors: ['Snapshot column accounts.colour is unknown to this server'],
        })}
      />,
    )
    expect(screen.getByText(/· incompatible$/)).toBeTruthy()
    expect(
      screen.getByText(
        'WARN: accounts.person_id is absent from the snapshot — the column default applies',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('ERROR: Snapshot column accounts.colour is unknown to this server'),
    ).toBeTruthy()
  })

  it('names the restore point once applied, and says every table is unchanged when it is', () => {
    render(
      <RestoreReportView
        report={report({
          dry_run: false,
          applied: true,
          restore_point: 'pre-restore-20260904-091500-123456.zip',
          tables: { accounts: { current: 1, incoming: 1, identical: true } },
        })}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('Restored.')
    expect(
      screen.getByText('Restore point written: pre-restore-20260904-091500-123456.zip'),
    ).toBeTruthy()
    expect(screen.getByText('1 table unchanged')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
