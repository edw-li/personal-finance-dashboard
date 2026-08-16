import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecurityOut } from '../../types/api'
import SecuritiesPanel from './SecuritiesPanel'

vi.mock('../../api/portfolio', () => ({
  createSecurity: vi.fn().mockResolvedValue({}),
  updateSecurity: vi.fn().mockResolvedValue({}),
  deleteSecurity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../api/prices', () => ({
  putManualPrice: vi.fn().mockResolvedValue({}),
}))
import { updateSecurity } from '../../api/portfolio'

afterEach(cleanup)
// Call counts are per-test; clearAllMocks keeps the factory's mockResolvedValue.
beforeEach(() => vi.clearAllMocks())

// Auto-priced: refresh owns annual_dividend/ex_div_date, so the panel hides the field.
const autoPriced: SecurityOut = {
  id: 1, ticker: 'NVDA', name: 'NVIDIA', industry: 'Semis', holding_type: 'stock',
  is_manual_priced: false, is_active: true, annual_dividend: '0.0400', ex_div_date: '2026-06-10',
}

// Manual-priced: refresh never touches it, so the dividend IS editable here.
const manualPriced: SecurityOut = {
  id: 2, ticker: 'HOUSE', name: 'Primary home', industry: null, holding_type: 'private',
  is_manual_priced: true, is_active: true, annual_dividend: null, ex_div_date: null,
}

describe('SecuritiesPanel', () => {
  it('round-trips the hidden annual dividend when editing an auto-priced security', async () => {
    const onChanged = vi.fn()
    render(<SecuritiesPanel securities={[autoPriced, manualPriced]} onChanged={onChanged} />)
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    // Offered on manual-priced rows, where the edit survives the next refresh…
    fireEvent.click(editButtons[1])
    expect(screen.getByLabelText(/annual dividend/i)).toBeTruthy()
    // …and hidden on auto-priced ones (Task 14 review I2): refresh would overwrite it.
    fireEvent.click(editButtons[0])
    expect(screen.queryByLabelText(/annual dividend/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Hidden must not mean blanked: the PATCH carries the stored value back unchanged,
    // otherwise saving any other field silently nulls the dividend. Exact shape — an
    // extra or missing key here is a wire-contract change.
    expect(vi.mocked(updateSecurity)).toHaveBeenCalledWith(1, {
      name: 'NVIDIA',
      industry: 'Semis',
      holding_type: 'stock',
      annual_dividend: '0.0400',
      is_manual_priced: false,
      is_active: true,
    })
  })

  it('confirm-deleting the row being edited resets the form to create mode', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChanged = vi.fn()
    render(<SecuritiesPanel securities={[autoPriced]} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Back to create mode: a stale editingId would PATCH the deleted id on the next save.
    expect(screen.getByRole('button', { name: /add security/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })
})
