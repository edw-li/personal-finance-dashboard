import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { HealthCheck, HealthOut } from '../../types/api'
import ToastProvider from '../ToastProvider'
import HealthCard from './HealthCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchHealth: vi.fn(),
  createSnapshot: vi.fn(),
  undoBatch: vi.fn(),
}))
vi.mock('../../api/spending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/spending')>()),
  deleteSpendingMonth: vi.fn(),
}))
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchTaxInputs: vi.fn(),
  putTaxInputsForRepair: vi.fn(),
}))
import { createSnapshot, fetchHealth, undoBatch } from '../../api/lifecycle'
import { deleteSpendingMonth } from '../../api/spending'
import { fetchTaxInputs, putTaxInputsForRepair } from '../../api/taxes'

const OK: HealthCheck = { id: 'stale_quotes', severity: 'ok', title: 'Quotes are fresh', detail: '', count: 0, months: [], years: [], fix: null }
const ZERO: HealthCheck = {
  id: 'zero_filled_spending', severity: 'error', title: 'Zero-filled spending month',
  detail: 'Sep 2026: every category is $0.00 and no take-home was entered — an empty month that reads as spending nothing.',
  count: 1, months: ['2026-09-01'], years: [],
  fix: { kind: 'action', action: 'delete_spending_month', label: 'Delete the zero-filled month' },
}
const GAP: HealthCheck = {
  id: 'balances_without_spending', severity: 'warn', title: 'Balances entered, spending missing',
  detail: 'Aug 2026: balances were saved but no spending row exists.', count: 1, months: ['2026-08-01'], years: [],
  fix: { kind: 'link', to: '/update?month=2026-08-01&step=spending', label: 'Enter Aug 2026 spending' },
}
const SNAP: HealthCheck = {
  id: 'snapshot', severity: 'warn', title: 'No stored snapshot yet', detail: 'The nightly snapshot has not written a file to the data volume.',
  count: 1, months: [], years: [], fix: { kind: 'action', action: 'snapshot_now', label: 'Snapshot now' },
}

// The §199A leftover (taxes spec 4h): a check about a YEAR, repaired by rewriting one
// stored figure through the ordinary inputs PUT.
const SEC199A: HealthCheck = {
  id: 'sec199a_in_itemized', severity: 'warn',
  title: 'Itemized deduction for 2025 still includes the §199A line',
  detail: '2025: the stored itemized total matches the OLD formula.',
  count: 1, months: [], years: [2025],
  fix: { kind: 'action', action: 'rewrite_itemized_deduction', label: 'Rewrite the itemized total' },
}

// Only the one row the card reads: the year's own itemized suggestion.
const ITEMIZED_INPUTS = {
  year: 2025, filing_status: 'single' as const, people: [],
  sections: [{
    section: 'deductions',
    items: [{
      key: 'itemized_deduction', label: 'Itemized Deduction', sort_order: 90, is_derived: true,
      unit: 'money' as const, is_per_person: false, person_id: null,
      value: '27213.2820', suggested: '27207.0600', suggestion_source: null,
    }],
  }],
}

function health(checks: HealthCheck[]): HealthOut {
  return { checked_at: '2026-09-04T09:00:00+00:00', checks }
}

function mount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HealthCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchHealth).mockResolvedValue(health([OK, ZERO, GAP, SNAP]))
  vi.mocked(deleteSpendingMonth).mockResolvedValue({ batchId: 'b-repair' })
  vi.mocked(fetchTaxInputs).mockResolvedValue(ITEMIZED_INPUTS)
  vi.mocked(putTaxInputsForRepair).mockResolvedValue({
    data: ITEMIZED_INPUTS,
    batchId: 'b-itemized',
  })
  vi.mocked(createSnapshot).mockResolvedValue({ name: 'finance-export-20260904-091500.zip', at: '2026-09-04T09:15:00+00:00', size_bytes: 1, alembic_head: null, restorable: true })
  vi.mocked(undoBatch).mockResolvedValue({
    type: 'batch', batch_id: 'u-1', at: '2026-09-04T09:00:00+00:00', source: 'undo', actor: null,
    label: 'Undid: Deleted Sep 2026 spending', month: '2026-09-01', rows: 19, undoable: true, undone_by: null,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HealthCard', () => {
  it('lists the non-ok checks with their severity in words and a link fix as a link', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Data health' })).toBeTruthy()
    expect(document.getElementById('health')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('error')
    expect(rows[0].textContent).toContain('Zero-filled spending month')
    expect(screen.queryByText('Quotes are fresh')).toBeNull()
    const link = screen.getByRole('link', { name: 'Enter Aug 2026 spending' })
    expect(link.getAttribute('href')).toBe('/update?month=2026-08-01&step=spending')
  })

  it('the repair arms on click, runs as a repair, toasts with Undo, and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Sep 2026' }))
    expect(deleteSpendingMonth).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sep 2026?' }))
    await waitFor(() => expect(deleteSpendingMonth).toHaveBeenCalledWith('2026-09-01', { source: 'repair' }))
    expect(await screen.findByText("Deleted Sep 2026's zero-filled rows")).toBeTruthy()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-repair'))
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(3))
  })

  it('Snapshot now runs the snapshot action and refetches', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Snapshot now' }))
    await waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Snapshot written — finance-export-20260904-091500.zip')).toBeTruthy()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))
  })

  it('rewrites one year\'s itemized total from the server\'s own suggestion', async () => {
    // The number is never computed here: the card reads the suggestion the inputs payload
    // already carries, so there is one definition of the itemized formula.
    vi.mocked(fetchHealth).mockResolvedValue(health([OK, SEC199A]))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite 2025' }))
    expect(putTaxInputsForRepair).not.toHaveBeenCalled() // armed, not fired

    fireEvent.click(screen.getByRole('button', { name: 'Rewrite 2025?' }))
    await waitFor(() =>
      expect(putTaxInputsForRepair).toHaveBeenCalledWith(2025, {
        values: { itemized_deduction: '27207.0600' },
      }),
    )
    expect(fetchTaxInputs).toHaveBeenCalledWith(2025)
    expect(
      await screen.findByText("Rewrote 2025's itemized deduction without the §199A line"),
    ).toBeTruthy()
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoBatch).toHaveBeenCalledWith('b-itemized'))
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(3))
  })

  it('refuses to guess when the year has no itemized suggestion', async () => {
    vi.mocked(fetchHealth).mockResolvedValue(health([OK, SEC199A]))
    vi.mocked(fetchTaxInputs).mockResolvedValue({
      ...ITEMIZED_INPUTS,
      sections: [{ section: 'deductions', items: [] }],
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite 2025' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite 2025?' }))

    expect(
      await screen.findByText('No itemized suggestion for 2025 — open the year and check it.'),
    ).toBeTruthy()
    expect(putTaxInputsForRepair).not.toHaveBeenCalled()
  })

  it('shows a failed repair verbatim and says when everything passes', async () => {
    vi.mocked(deleteSpendingMonth).mockRejectedValue(new ApiError('no spending or net pay recorded for this month', 404))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Sep 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sep 2026?' }))
    // By TEXT, then by role: ToastProvider keeps an always-mounted assertive region, so
    // findByRole('alert') would resolve on that empty region before the banner arrives.
    const banner = (await screen.findByText('no spending or net pay recorded for this month'))
      .closest('[role="alert"]')
    expect(banner).not.toBeNull()
    cleanup()
    vi.mocked(fetchHealth).mockResolvedValue(health([OK]))
    mount()
    expect(await screen.findByText('All checks pass.')).toBeTruthy()
  })
})
