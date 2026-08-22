import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { putManualPrice } from '../../api/prices'

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

// The same row carrying a stored 4dp dividend — the precision the display must not round off.
const manualWithDividend: SecurityOut = { ...manualPriced, annual_dividend: '1.2345' }

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

  it('canonicalizes a manual price at the wire boundary with no blur', async () => {
    const onChanged = vi.fn()
    render(<SecuritiesPanel securities={[manualPriced]} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set price' }))
    // Exact 'Price': the entry form's checkbox label reads "Manual price", which a loose
    // /price/i would match too.
    const input = screen.getByLabelText('Price') as HTMLInputElement
    // The one AmountInput that is NOT inside a column-flex label: .field-input's width:100%
    // would spill this nowrap actions cell past the panel edge, so the parent bounds it.
    // Asserted because jsdom cannot see the layout the class exists to fix — if the hook
    // ever detaches, only this catches it.
    expect(input.className).toContain('price-mini')
    fireEvent.change(input, { target: { value: '$123.4567' } })
    // kind="plain" still runs the tolerant parse — parseAmount is kind-independent, so "$"
    // and grouping commas are stripped for the display exactly as for money. Only the
    // "=" evaluator and the ECHO differ: money would render "$123.46" here and hide the
    // last two digits of a 4dp column, so the display stays verbatim-canonical instead.
    expect(input.value).toBe('123.4567')
    // Typed and clicked, never blurred — the belt is what canonicalizes.
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(putManualPrice)).toHaveBeenCalledWith('HOUSE', { price: '123.4567' })
  })

  it('never evaluates an =-expression in the manual price — cell AND belt refuse', async () => {
    const onChanged = vi.fn()
    render(<SecuritiesPanel securities={[manualPriced]} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set price' }))
    const input = screen.getByLabelText('Price') as HTMLInputElement
    // A REAL focus/blur cycle, which is the half a payload-only pin cannot reach: with a
    // money kind the cell itself would commit the evaluator's 2dp '33.33' into state on
    // blur, and the belt would then ship that verbatim — evaluation happening anyway
    // through the input side. kind="plain" is what closes it, so both halves are asserted.
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '=100/3' } })
    act(() => input.blur())
    expect(input.value).toBe('=100/3') // the cell did not evaluate
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // …and neither did the belt. price is a 4dp column: '=100/3' is 33.3333, which the 2dp
    // evaluator would coarsen to 33.33. The text travels verbatim and the server's 422 is
    // the backstop, exactly as for any other garbage typed here.
    expect(vi.mocked(putManualPrice)).toHaveBeenCalledWith('HOUSE', { price: '=100/3' })
  })

  it('shows a stored 4dp annual dividend verbatim — no lossy 2dp $ echo', () => {
    render(<SecuritiesPanel securities={[manualWithDividend]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // annual_dividend is a 4dp column too: a money echo would render "$1.23" and hide two
    // stored digits, so this field is plain-kind as well.
    expect((screen.getByLabelText(/annual dividend/i) as HTMLInputElement).value).toBe('1.2345')
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
